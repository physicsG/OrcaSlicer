#ifndef slic3r_MultiAceMachineModel_hpp_
#define slic3r_MultiAceMachineModel_hpp_

#include "libslic3r/MultiAceAmsProjection.hpp"
#include "slic3r/GUI/DeviceManager.hpp"

#include <cassert>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>

namespace Slic3r::MultiAce {

struct AmsModelTarget
{
    std::map<std::string, Ams*>& ams_list;
    long&                        ams_exist_bits;
    long&                        tray_exist_bits;
    long&                        tray_is_bbl_bits;
    long&                        tray_read_done_bits;
    long&                        tray_reading_bits;
    bool&                        is_ams_need_update;
};

inline AmsModelTarget make_ams_model_target(MachineObject& machine)
{
    return {machine.amsList,
            machine.ams_exist_bits,
            machine.tray_exist_bits,
            machine.tray_is_bbl_bits,
            machine.tray_read_done_bits,
            machine.tray_reading_bits,
            machine.is_ams_need_update};
}

struct AmsSourceMetadata
{
    FilamentSource source;
    std::string    inventory_revision;
};

struct AmsSourceSlot
{
    std::string ams_id;
    std::string tray_id;
};

class MultiAceMachineModel
{
public:
    explicit MultiAceMachineModel(AmsModelTarget target) : m_target(target), m_owner_thread(std::this_thread::get_id()) {}
    explicit MultiAceMachineModel(MachineObject& machine) : MultiAceMachineModel(make_ams_model_target(machine)) {}

    ~MultiAceMachineModel()
    {
        assert(std::this_thread::get_id() == m_owner_thread && "multiACE machine model must be destroyed on its owner thread");
        clear_impl();
    }

    MultiAceMachineModel(const MultiAceMachineModel&)            = delete;
    MultiAceMachineModel& operator=(const MultiAceMachineModel&) = delete;
    MultiAceMachineModel(MultiAceMachineModel&&)                 = delete;
    MultiAceMachineModel& operator=(MultiAceMachineModel&&)      = delete;

    void apply(const InventorySnapshot& inventory)
    {
        require_owner_thread();
        const AmsInventoryProjection projection = project_inventory_to_ams(inventory);

        for (const AmsUnitProjection& unit : projection.units) {
            const auto existing = m_target.ams_list.find(unit.ams_id);
            const auto owned    = m_units.find(unit.ams_id);
            if (existing != m_target.ams_list.end() &&
                (owned == m_units.end() || existing->second != owned->second.ams.get())) {
                throw std::invalid_argument("multiACE AMS unit ID collides with an existing machine AMS entry: " + unit.ams_id);
            }
        }

        std::set<std::string> retained_units;
        for (const AmsUnitProjection& unit : projection.units) {
            retained_units.emplace(unit.ams_id);
            OwnedUnit& owned = get_or_create_unit(unit);
            update_unit(owned, unit);
        }

        for (auto iterator = m_units.begin(); iterator != m_units.end();) {
            if (retained_units.find(iterator->first) != retained_units.end()) {
                ++iterator;
                continue;
            }
            erase_target_unit(iterator->first, iterator->second);
            iterator = m_units.erase(iterator);
        }

        m_metadata.clear();
        m_source_slots.clear();
        for (const AmsUnitProjection& unit : projection.units) {
            for (const AmsTrayProjection& tray : unit.trays) {
                const auto slot_key = std::make_pair(tray.ams_id, tray.tray_id);
                m_metadata.emplace(slot_key, AmsSourceMetadata{tray.source, projection.revision});
                m_source_slots.emplace(tray.source_id, AmsSourceSlot{tray.ams_id, tray.tray_id});
            }
        }

        replace_owned_mask(m_target.ams_exist_bits, m_owned_ams_exist_bits, projection.ams_exist_bits);
        replace_owned_mask(m_target.tray_exist_bits, m_owned_tray_exist_bits, projection.tray_exist_bits);
        replace_owned_mask(m_target.tray_is_bbl_bits, m_owned_tray_is_bbl_bits, projection.tray_is_bbl_bits);
        replace_owned_mask(m_target.tray_read_done_bits, m_owned_tray_read_done_bits, projection.tray_read_done_bits);
        replace_owned_mask(m_target.tray_reading_bits, m_owned_tray_reading_bits, projection.tray_reading_bits);

        m_revision                   = projection.revision;
        m_target.is_ams_need_update = true;
    }

    void clear()
    {
        require_owner_thread();
        clear_impl();
    }

    const AmsSourceMetadata* source_metadata(const std::string& ams_id, const std::string& tray_id) const
    {
        require_owner_thread();
        const auto found = m_metadata.find(std::make_pair(ams_id, tray_id));
        return found == m_metadata.end() ? nullptr : &found->second;
    }

    std::optional<AmsSourceSlot> slot_for_source(const SourceId& source) const
    {
        require_owner_thread();
        const auto found = m_source_slots.find(source.str());
        if (found == m_source_slots.end())
            return std::nullopt;
        return found->second;
    }

    const std::string& revision() const
    {
        require_owner_thread();
        return m_revision;
    }

    std::thread::id owner_thread() const { return m_owner_thread; }

private:
    struct OwnedUnit
    {
        std::unique_ptr<Ams>                            ams;
        std::map<std::string, std::unique_ptr<AmsTray>> trays;
    };

    static AmsRoadPosition road_position(ProjectedRoadPosition position)
    {
        switch (position) {
        case ProjectedRoadPosition::Tube: return AMS_ROAD_POSITION_TUBE;
        case ProjectedRoadPosition::Hotend: return AMS_ROAD_POSITION_HOTEND;
        case ProjectedRoadPosition::Tray: return AMS_ROAD_POSITION_TRAY;
        }
        return AMS_ROAD_POSITION_TRAY;
    }

    static AmsStep step_state(ProjectedStepState state)
    {
        switch (state) {
        case ProjectedStepState::Loading: return AMS_STEP_LOADING;
        case ProjectedStepState::Completed: return AMS_STEP_COMPLETED;
        case ProjectedStepState::Init: return AMS_STEP_INIT;
        }
        return AMS_STEP_INIT;
    }

    OwnedUnit& get_or_create_unit(const AmsUnitProjection& unit)
    {
        auto found = m_units.find(unit.ams_id);
        if (found != m_units.end())
            return found->second;

        OwnedUnit owned;
        owned.ams = std::make_unique<Ams>(unit.ams_id, unit.nozzle, 1);
        Ams* raw  = owned.ams.get();
        const auto inserted = m_units.emplace(unit.ams_id, std::move(owned));
        try {
            const auto target_inserted = m_target.ams_list.emplace(unit.ams_id, raw);
            if (!target_inserted.second)
                throw std::logic_error("multiACE AMS target changed during model update");
        } catch (...) {
            m_units.erase(inserted.first);
            throw;
        }
        return inserted.first->second;
    }

    static void update_tray(AmsTray& tray, const AmsTrayProjection& projection)
    {
        tray.id                  = projection.tray_id;
        tray.tag_uid             = projection.source.rfid_uid;
        tray.setting_id.clear();
        tray.filament_setting_id.clear();
        tray.type                = projection.source.material;
        tray.sub_brands          = projection.source.subtype.empty() ? projection.source.brand : projection.source.subtype;
        tray.color               = projection.color_rgba;
        tray.cols.clear();
        tray.weight.clear();
        tray.diameter.clear();
        tray.temp.clear();
        tray.time.clear();
        tray.bed_temp_type.clear();
        tray.bed_temp.clear();
        tray.nozzle_temp_max.clear();
        tray.nozzle_temp_min.clear();
        tray.xcam_info.clear();
        tray.uuid          = projection.source_id;
        tray.ctype         = 0;
        tray.k             = 0.0f;
        tray.n             = 0.0f;
        tray.cali_idx      = 0;
        tray.is_bbl        = false;
        tray.is_exists     = projection.exists;
        tray.hold_count    = 0;
        tray.remain        = projection.source.remaining_percent.value_or(0);
        tray.road_position = road_position(projection.road_position);
        tray.step_state    = step_state(projection.step_state);
        tray.rfid_state    = projection.rfid_read_done ? AMS_REID_DONE : AMS_RFID_INIT;
    }

    static void update_unit_fields(Ams& ams, const AmsUnitProjection& projection)
    {
        ams.id                  = projection.ams_id;
        ams.nozzle              = projection.nozzle;
        ams.type                = 1;
        ams.is_exists           = true;
        ams.humidity            = projection.humidity_level;
        ams.humidity_raw        = projection.humidity_raw;
        ams.current_temperature = projection.current_temperature.has_value()
                                      ? static_cast<float>(*projection.current_temperature)
                                      : INVALID_AMS_TEMPERATURE;
        ams.left_dry_time       = projection.dryer_remaining_seconds;
    }

    void update_unit(OwnedUnit& owned, const AmsUnitProjection& projection)
    {
        update_unit_fields(*owned.ams, projection);

        std::set<std::string> retained_trays;
        for (const AmsTrayProjection& tray_projection : projection.trays) {
            retained_trays.emplace(tray_projection.tray_id);
            auto found = owned.trays.find(tray_projection.tray_id);
            if (found == owned.trays.end()) {
                auto     tray = std::make_unique<AmsTray>(tray_projection.tray_id);
                AmsTray* raw  = tray.get();
                found         = owned.trays.emplace(tray_projection.tray_id, std::move(tray)).first;
                const auto tray_inserted = owned.ams->trayList.emplace(tray_projection.tray_id, raw);
                if (!tray_inserted.second) {
                    owned.trays.erase(found);
                    throw std::logic_error("multiACE AMS tray target changed during model update");
                }
            }
            update_tray(*found->second, tray_projection);
        }

        for (auto iterator = owned.trays.begin(); iterator != owned.trays.end();) {
            if (retained_trays.find(iterator->first) != retained_trays.end()) {
                ++iterator;
                continue;
            }
            owned.ams->trayList.erase(iterator->first);
            iterator = owned.trays.erase(iterator);
        }
    }

    void erase_target_unit(const std::string& ams_id, const OwnedUnit& owned)
    {
        const auto found = m_target.ams_list.find(ams_id);
        if (found != m_target.ams_list.end() && found->second == owned.ams.get())
            m_target.ams_list.erase(found);
    }

    static void replace_owned_mask(long& target, long& owned_mask, long next_mask)
    {
        const long external_mask = target & ~owned_mask;
        target                   = external_mask | next_mask;
        owned_mask               = next_mask & ~external_mask;
    }

    void clear_impl()
    {
        const bool changed = !m_units.empty() || m_owned_ams_exist_bits != 0 || m_owned_tray_exist_bits != 0 ||
                             m_owned_tray_is_bbl_bits != 0 || m_owned_tray_read_done_bits != 0 || m_owned_tray_reading_bits != 0;

        for (const auto& [ams_id, owned] : m_units)
            erase_target_unit(ams_id, owned);
        m_units.clear();
        m_metadata.clear();
        m_source_slots.clear();
        m_revision.clear();

        replace_owned_mask(m_target.ams_exist_bits, m_owned_ams_exist_bits, 0);
        replace_owned_mask(m_target.tray_exist_bits, m_owned_tray_exist_bits, 0);
        replace_owned_mask(m_target.tray_is_bbl_bits, m_owned_tray_is_bbl_bits, 0);
        replace_owned_mask(m_target.tray_read_done_bits, m_owned_tray_read_done_bits, 0);
        replace_owned_mask(m_target.tray_reading_bits, m_owned_tray_reading_bits, 0);

        if (changed)
            m_target.is_ams_need_update = true;
    }

    void require_owner_thread() const
    {
        if (std::this_thread::get_id() != m_owner_thread)
            throw std::logic_error("multiACE AMS model may only be accessed from its owner thread");
    }

    AmsModelTarget  m_target;
    std::thread::id m_owner_thread;

    std::map<std::string, OwnedUnit>                                  m_units;
    std::map<std::pair<std::string, std::string>, AmsSourceMetadata> m_metadata;
    std::map<std::string, AmsSourceSlot>                              m_source_slots;
    std::string                                                       m_revision;

    long m_owned_ams_exist_bits      = 0;
    long m_owned_tray_exist_bits     = 0;
    long m_owned_tray_is_bbl_bits    = 0;
    long m_owned_tray_read_done_bits = 0;
    long m_owned_tray_reading_bits   = 0;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceMachineModel_hpp_
