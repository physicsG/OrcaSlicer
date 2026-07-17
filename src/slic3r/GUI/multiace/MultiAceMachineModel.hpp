#ifndef slic3r_MultiAceMachineModel_hpp_
#define slic3r_MultiAceMachineModel_hpp_

#include "libslic3r/MultiAceAmsModel.hpp"
#include "slic3r/GUI/DeviceManager.hpp"

#include <map>
#include <memory>
#include <string>

namespace Slic3r::MultiAce {

struct GuiAmsModelTraits
{
    using AmsType  = Ams;
    using TrayType = AmsTray;

    static std::unique_ptr<Ams> create_ams(const AmsUnitProjection& projection)
    {
        return std::make_unique<Ams>(projection.ams_id, projection.nozzle, 1);
    }

    static std::unique_ptr<AmsTray> create_tray(const AmsTrayProjection& projection)
    {
        return std::make_unique<AmsTray>(projection.tray_id);
    }

    static std::map<std::string, AmsTray*>& tray_list(Ams& ams) { return ams.trayList; }

    static void update_ams(Ams& ams, const AmsUnitProjection& projection)
    {
        ams.id                  = projection.ams_id;
        ams.nozzle              = projection.nozzle;
        ams.type                = 1;
        ams.is_exists           = true;
        ams.humidity            = projection.humidity_level;
        ams.humidity_raw        = projection.humidity_raw;
        ams.current_temperature = projection.current_temperature.has_value() ? static_cast<float>(*projection.current_temperature) :
                                                                               INVALID_AMS_TEMPERATURE;
        ams.left_dry_time       = projection.dryer_remaining_seconds;
    }

    static void update_tray(AmsTray& tray, const AmsTrayProjection& projection)
    {
        // Only update fields owned by the live inventory bridge. Profile,
        // calibration, UUID, and other GUI-managed fields must survive refreshes.
        tray.id            = projection.tray_id;
        tray.tag_uid       = projection.source.rfid_uid;
        tray.type          = projection.source.material;
        tray.sub_brands    = projection.source.subtype.empty() ? projection.source.brand : projection.source.subtype;
        tray.color         = projection.color_rgba;
        tray.is_exists     = projection.exists;
        tray.remain        = projection.source.remaining_percent.value_or(0);
        tray.road_position = road_position(projection.road_position);
        tray.step_state    = step_state(projection.step_state);
        tray.rfid_state    = projection.rfid_read_done ? AMS_REID_DONE : AMS_RFID_INIT;
    }

private:
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
};

inline AmsModelTarget<Ams> make_ams_model_target(MachineObject& machine)
{
    return {machine.amsList,           machine.ams_exist_bits,      machine.tray_exist_bits,
            machine.tray_is_bbl_bits,  machine.tray_read_done_bits, machine.tray_reading_bits,
            machine.is_ams_need_update};
}

class MultiAceMachineModel final : public BasicMultiAceAmsModel<GuiAmsModelTraits>
{
public:
    using BasicMultiAceAmsModel<GuiAmsModelTraits>::BasicMultiAceAmsModel;

    explicit MultiAceMachineModel(MachineObject& machine) : BasicMultiAceAmsModel<GuiAmsModelTraits>(make_ams_model_target(machine)) {}
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceMachineModel_hpp_
