#include <catch2/catch.hpp>

#include "slic3r/GUI/multiace/MultiAceMachineModel.hpp"

#include <string>
#include <vector>

using namespace Slic3r;
using namespace Slic3r::MultiAce;

TEST_CASE("multiACE GUI tray refresh preserves profile-managed fields", "[multiace][ams][gui]")
{
    AmsTray tray("0");
    tray.setting_id          = "setting-id";
    tray.filament_setting_id = "filament-profile-id";
    tray.uuid                = "profile-uuid";
    tray.cols                = {"112233FF", "445566FF"};
    tray.ctype               = 2;
    tray.k                   = 0.035f;
    tray.n                   = 1.25f;
    tray.cali_idx            = 7;
    tray.weight              = "1000";
    tray.diameter            = "1.75";
    tray.nozzle_temp_min     = "190";
    tray.nozzle_temp_max     = "230";

    AmsTrayProjection projection;
    projection.tray_id                  = "0";
    projection.source.id                = SourceId{"multiace", "1", "0"};
    projection.source.rfid_uid          = "rfid-10";
    projection.source.material          = "PETG";
    projection.source.subtype           = "PETG Basic";
    projection.source.color             = "#010203";
    projection.source.remaining_percent = 61;
    projection.color_rgba               = "010203FF";
    projection.exists                   = true;
    projection.rfid_read_done           = true;
    projection.road_position            = ProjectedRoadPosition::Hotend;
    projection.step_state               = ProjectedStepState::Completed;

    GuiAmsModelTraits::update_tray(tray, projection);

    CHECK(tray.tag_uid == "rfid-10");
    CHECK(tray.type == "PETG");
    CHECK(tray.sub_brands == "PETG Basic");
    CHECK(tray.color == "010203FF");
    CHECK(tray.remain == 61);
    CHECK(tray.is_exists);
    CHECK(tray.rfid_state == AMS_REID_DONE);
    CHECK(tray.road_position == AMS_ROAD_POSITION_HOTEND);
    CHECK(tray.step_state == AMS_STEP_COMPLETED);

    CHECK(tray.setting_id == "setting-id");
    CHECK(tray.filament_setting_id == "filament-profile-id");
    CHECK(tray.uuid == "profile-uuid");
    CHECK((tray.cols == std::vector<std::string>{"112233FF", "445566FF"}));
    CHECK(tray.ctype == 2);
    CHECK(tray.k == Approx(0.035f));
    CHECK(tray.n == Approx(1.25f));
    CHECK(tray.cali_idx == 7);
    CHECK(tray.weight == "1000");
    CHECK(tray.diameter == "1.75");
    CHECK(tray.nozzle_temp_min == "190");
    CHECK(tray.nozzle_temp_max == "230");
}
