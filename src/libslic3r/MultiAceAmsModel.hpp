#ifndef slic3r_MultiAceAmsModel_hpp_
#define slic3r_MultiAceAmsModel_hpp_

#include "MultiAceAmsProjection.hpp"

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

template<class AmsType> struct AmsModelTarget
{
    std::map<std::string, AmsType*>& ams_list;
    long&                            ams_exist_bits;
    long&                            tray_exist_bits;
    long&                            tray_is_bbl_bits;
    long&                            tray_read_done_bits;
    long&                            tray_reading_bits;
    bool&                            is_ams_need_update;
};

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

// Traits must expose AmsType, TrayType, create_ams(), create_tray(), tray_list(),
// update_ams(), and update_tray(). The ownership and lifecycle rules stay
// independent from the GUI's concrete Ams and AmsTray definitions.
template<class Traits> class BasicMultiAceAmsModel
{
public:
    using AmsType  = typename Traits::AmsType;
    using TrayType = typename Traits::TrayType;

    explicit BasicMultiAceAmsModel(AmsModelTarget<AmsType> target) : m_target(target), m_owner_thread(std::this_thread::get_id()) {}

    ~BasicMultiAceAmsModel()
    {
        assert(std::this_thread::get_id() == m_owner_thread && "multiACE machine model must be destroyed on its owner thread");
        clear_impl();
    }

    BasicMultiAceAmsModel(const BasicMultiAceAmsModel&)            = delete;
    BasicMultiAceAmsModel& operator=(const BasicMultiAceAmsModel&) = delete;
    BasicMultiAceAmsModel(BasicMultiAceAmsModel&&)                 = delete;
    BasicMultiAceAmsModel& operator=(BasicMultiAceAmsModel&&)      = delete;

    void apply(const InventorySnapshot& inventory)
    {
        require_owner_thread();
        const AmsInventoryProjection projection = project_inventory_to_ams(inventory);

        std::set<std::string> retained_units;
        MetadataMap           next_metadata;
        SourceSlotMap         next_source_slots;
        for (const AmsUnitProjection& unit : projection.units) {
            retained_units.emplace(unit.ams_id);
            validate_target_unit(unit.ams_id);

            const auto owned = m_units.find(unit.ams_id);
            if (owned != m_units.end()) {
                const auto& tray_list = Traits::tray_list(*owned->second.ams);
                for (const AmsTrayProjection& tray : unit.trays)
                    validate_target_tray(owned->second, tray_list, unit.ams_id, tray.tray_id);
            }

            for (const AmsTrayProjection& tray : unit.trays) {
                const auto slot_key = std::make_pair(tray.ams_id, tray.tray_id);
                if (!next_metadata.emplace(slot_key, AmsSourceMetadata{tray.source, projection.revision}).second)
                    throw std::logic_error("multiACE projection contains duplicate AMS slot metadata");
                if (!next_source_slots.emplace(tray.source_id, AmsSourceSlot{tray.ams_id, tray.tray_id}).second)
                    throw std::logic_error("multiACE projection contains duplicate source metadata");
            }
        }

        for (const AmsUnitProjection& unit : projection.units) {
            OwnedUnit& owned = get_or_create_unit(unit);
            ensure_target_unit(unit.ams_id, owned);
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

        m_metadata.swap(next_metadata);
        m_source_slots.swap(next_source_slots);

        replace_owned_mask(m_target.ams_exist_bits, m_owned_ams_exist_bits, projection.ams_exist_bits);
        replace_owned_mask(m_target.tray_exist_bits, m_owned_tray_exist_bits, projection.tray_exist_bits);
        replace_owned_mask(m_target.tray_is_bbl_bits, m_owned_tray_is_bbl_bits, projection.tray_is_bbl_bits);
        replace_owned_mask(m_target.tray_read_done_bits, m_owned_tray_read_done_bits, projection.tray_read_done_bits);
        replace_owned_mask(m_target.tray_reading_bits, m_owned_tray_reading_bits, projection.tray_reading_bits);

        m_revision                  = projection.revision;
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
        std::unique_ptr<AmsType>                         ams;
        std::map<std::string, std::unique_ptr<TrayType>> trays;
    };

    using MetadataMap   = std::map<std::pair<std::string, std::string>, AmsSourceMetadata>;
    using SourceSlotMap = std::map<std::string, AmsSourceSlot>;

    void validate_target_unit(const std::string& ams_id) const
    {
        const auto existing = m_target.ams_list.find(ams_id);
        const auto owned    = m_units.find(ams_id);
        if (owned == m_units.end()) {
            if (existing != m_target.ams_list.end())
                throw std::invalid_argument("multiACE AMS unit ID collides with an existing machine AMS entry: " + ams_id);
            return;
        }
        if (existing != m_target.ams_list.end() && existing->second != owned->second.ams.get())
            throw std::logic_error("multiACE AMS target changed during model update: " + ams_id);
    }

    OwnedUnit& get_or_create_unit(const AmsUnitProjection& unit)
    {
        auto found = m_units.find(unit.ams_id);
        if (found != m_units.end())
            return found->second;

        OwnedUnit owned;
        owned.ams = Traits::create_ams(unit);
        if (!owned.ams)
            throw std::logic_error("multiACE AMS traits returned a null unit");

        AmsType*   raw      = owned.ams.get();
        const auto inserted = m_units.emplace(unit.ams_id, std::move(owned));
        try {
            const auto target_inserted = m_target.ams_list.emplace(unit.ams_id, raw);
            if (!target_inserted.second)
                throw std::logic_error("multiACE AMS target changed during model update: " + unit.ams_id);
        } catch (...) {
            m_units.erase(inserted.first);
            throw;
        }
        return inserted.first->second;
    }

    void ensure_target_unit(const std::string& ams_id, const OwnedUnit& owned)
    {
        const auto found = m_target.ams_list.find(ams_id);
        if (found == m_target.ams_list.end()) {
            const auto inserted = m_target.ams_list.emplace(ams_id, owned.ams.get());
            if (!inserted.second)
                throw std::logic_error("multiACE AMS target changed during model update: " + ams_id);
            return;
        }
        if (found->second != owned.ams.get())
            throw std::logic_error("multiACE AMS target changed during model update: " + ams_id);
    }

    void update_unit(OwnedUnit& owned, const AmsUnitProjection& projection)
    {
        auto& tray_list = Traits::tray_list(*owned.ams);

        std::set<std::string> retained_trays;
        for (const AmsTrayProjection& tray_projection : projection.trays)
            retained_trays.emplace(tray_projection.tray_id);

        Traits::update_ams(*owned.ams, projection);
        for (const AmsTrayProjection& tray_projection : projection.trays) {
            auto found = owned.trays.find(tray_projection.tray_id);
            if (found == owned.trays.end()) {
                auto tray = Traits::create_tray(tray_projection);
                if (!tray)
                    throw std::logic_error("multiACE AMS traits returned a null tray");

                TrayType* raw = tray.get();
                found         = owned.trays.emplace(tray_projection.tray_id, std::move(tray)).first;
                try {
                    const auto tray_inserted = tray_list.emplace(tray_projection.tray_id, raw);
                    if (!tray_inserted.second)
                        throw std::logic_error("multiACE AMS tray target changed during model update: " + projection.ams_id + ':' +
                                               tray_projection.tray_id);
                } catch (...) {
                    owned.trays.erase(found);
                    throw;
                }
            } else {
                ensure_target_tray(tray_list, projection.ams_id, tray_projection.tray_id, found->second.get());
            }
            Traits::update_tray(*found->second, tray_projection);
        }

        for (auto iterator = owned.trays.begin(); iterator != owned.trays.end();) {
            if (retained_trays.find(iterator->first) != retained_trays.end()) {
                ++iterator;
                continue;
            }
            erase_target_tray(tray_list, iterator->first, iterator->second.get());
            iterator = owned.trays.erase(iterator);
        }
    }

    static void validate_target_tray(const OwnedUnit&                        owned,
                                     const std::map<std::string, TrayType*>& tray_list,
                                     const std::string&                      ams_id,
                                     const std::string&                      tray_id)
    {
        const auto owned_tray  = owned.trays.find(tray_id);
        const auto target_tray = tray_list.find(tray_id);
        if (owned_tray == owned.trays.end()) {
            if (target_tray != tray_list.end())
                throw std::logic_error("multiACE AMS tray target changed during model update: " + ams_id + ':' + tray_id);
            return;
        }
        if (target_tray != tray_list.end() && target_tray->second != owned_tray->second.get())
            throw std::logic_error("multiACE AMS tray target changed during model update: " + ams_id + ':' + tray_id);
    }

    static void ensure_target_tray(std::map<std::string, TrayType*>& tray_list,
                                   const std::string&                ams_id,
                                   const std::string&                tray_id,
                                   TrayType*                         tray)
    {
        const auto found = tray_list.find(tray_id);
        if (found == tray_list.end()) {
            const auto inserted = tray_list.emplace(tray_id, tray);
            if (!inserted.second)
                throw std::logic_error("multiACE AMS tray target changed during model update: " + ams_id + ':' + tray_id);
            return;
        }
        if (found->second != tray)
            throw std::logic_error("multiACE AMS tray target changed during model update: " + ams_id + ':' + tray_id);
    }

    static void erase_target_tray(std::map<std::string, TrayType*>& tray_list, const std::string& tray_id, const TrayType* tray)
    {
        const auto found = tray_list.find(tray_id);
        if (found != tray_list.end() && found->second == tray)
            tray_list.erase(found);
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

    AmsModelTarget<AmsType> m_target;
    std::thread::id         m_owner_thread;

    std::map<std::string, OwnedUnit> m_units;
    MetadataMap                      m_metadata;
    SourceSlotMap                    m_source_slots;
    std::string                      m_revision;

    long m_owned_ams_exist_bits      = 0;
    long m_owned_tray_exist_bits     = 0;
    long m_owned_tray_is_bbl_bits    = 0;
    long m_owned_tray_read_done_bits = 0;
    long m_owned_tray_reading_bits   = 0;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceAmsModel_hpp_
