#include <catch2/catch.hpp>

#include "libslic3r/MultiAceAmsModel.hpp"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

using namespace Slic3r::MultiAce;

namespace {

struct RegressionTray
{
    std::string id;
    std::string material;
};

struct LiveFieldTray
{
    std::string id;
    std::string tag_uid;
    std::string type;
    std::string sub_brands;
    std::string color;
    bool        is_exists     = false;
    int         remain        = 0;
    int         road_position = 0;
    int         step_state    = 0;
    int         rfid_state    = 0;

    std::string              setting_id          = "setting-id";
    std::string              filament_setting_id = "filament-profile-id";
    std::string              uuid                = "profile-uuid";
    std::vector<std::string> cols                = {"112233FF", "445566FF"};
    int                      cali_idx            = 7;
};

struct RegressionAms
{
    std::string                            id;
    std::map<std::string, RegressionTray*> trays;
};

struct RegressionTraits
{
    using AmsType  = RegressionAms;
    using TrayType = RegressionTray;

    static std::unique_ptr<RegressionAms> create_ams(const AmsUnitProjection& projection)
    {
        auto ams = std::make_unique<RegressionAms>();
        ams->id  = projection.ams_id;
        return ams;
    }

    static std::unique_ptr<RegressionTray> create_tray(const AmsTrayProjection& projection)
    {
        auto tray = std::make_unique<RegressionTray>();
        tray->id  = projection.tray_id;
        return tray;
    }

    static std::map<std::string, RegressionTray*>& tray_list(RegressionAms& ams) { return ams.trays; }

    static void update_ams(RegressionAms& ams, const AmsUnitProjection& projection) { ams.id = projection.ams_id; }

    static void update_tray(RegressionTray& tray, const AmsTrayProjection& projection)
    {
        tray.id       = projection.tray_id;
        tray.material = projection.source.material;
    }
};

struct RegressionTarget
{
    std::map<std::string, RegressionAms*> ams_list;
    long                                  ams_exist_bits      = 0;
    long                                  tray_exist_bits     = 0;
    long                                  tray_is_bbl_bits    = 0;
    long                                  tray_read_done_bits = 0;
    long                                  tray_reading_bits   = 0;
    bool                                  needs_update        = false;

    AmsModelTarget<RegressionAms> model_target()
    {
        return {ams_list, ams_exist_bits, tray_exist_bits, tray_is_bbl_bits, tray_read_done_bits, tray_reading_bits, needs_update};
    }
};

FilamentSource regression_source(std::string unit, std::string slot, std::vector<int> reachable = {0}, std::optional<int> loaded = {})
{
    FilamentSource source;
    source.id                  = SourceId{"multiace", std::move(unit), std::move(slot)};
    source.material            = "PLA";
    source.state               = SourceState::Ready;
    source.reachable_toolheads = std::move(reachable);
    source.loaded_toolhead     = loaded;
    return source;
}

InventorySnapshot regression_inventory(std::string revision, std::vector<FilamentSource> sources)
{
    return {SUPPORTED_SCHEMA_VERSION, std::move(revision), std::move(sources)};
}

using RegressionModel = BasicMultiAceAmsModel<RegressionTraits>;

} // namespace

TEST_CASE("multiACE model restores missing owned target entries", "[multiace][ams][regression]")
{
    RegressionTarget target;
    RegressionModel  model(target.model_target());
    model.apply(regression_inventory("r1", {regression_source("0", "0")}));

    RegressionAms*  ams  = target.ams_list.at("0");
    RegressionTray* tray = ams->trays.at("0");

    target.ams_list.erase("0");
    model.apply(regression_inventory("r2", {regression_source("0", "0")}));
    CHECK(target.ams_list.at("0") == ams);

    ams->trays.erase("0");
    model.apply(regression_inventory("r3", {regression_source("0", "0")}));
    CHECK(ams->trays.at("0") == tray);
}

TEST_CASE("multiACE model rejects replaced owned unit pointers", "[multiace][ams][regression]")
{
    RegressionTarget target;
    RegressionAms    replacement;
    RegressionModel  model(target.model_target());
    model.apply(regression_inventory("r1", {regression_source("0", "0")}));

    target.ams_list["0"] = &replacement;
    CHECK_THROWS_WITH(model.apply(regression_inventory("r2", {regression_source("0", "0")})),
                      "multiACE AMS target changed during model update: 0");
    CHECK(target.ams_list.at("0") == &replacement);
}

TEST_CASE("multiACE model rejects replaced owned tray pointers", "[multiace][ams][regression]")
{
    RegressionTarget target;
    RegressionTray   replacement;
    RegressionModel  model(target.model_target());
    model.apply(regression_inventory("r1", {regression_source("0", "0")}));

    RegressionAms* ams = target.ams_list.at("0");
    ams->trays["0"]    = &replacement;
    CHECK_THROWS_WITH(model.apply(regression_inventory("r2", {regression_source("0", "0")})),
                      "multiACE AMS tray target changed during model update: 0:0");
    CHECK(ams->trays.at("0") == &replacement);
}

TEST_CASE("multiACE model preserves externally replaced trays when a source disappears", "[multiace][ams][regression]")
{
    RegressionTarget target;
    RegressionTray   replacement;
    RegressionModel  model(target.model_target());
    model.apply(regression_inventory("r1", {regression_source("0", "0"), regression_source("0", "1")}));

    RegressionAms* ams = target.ams_list.at("0");
    ams->trays["1"]    = &replacement;
    model.apply(regression_inventory("r2", {regression_source("0", "0")}));

    CHECK(ams->trays.at("1") == &replacement);
}

TEST_CASE("multiACE projection rejects loaded sources without a declared route", "[multiace][ams][regression]")
{
    CHECK_THROWS_WITH(project_inventory_to_ams(regression_inventory("r1", {regression_source("0", "0", {}, 2)})),
                      "multiACE loaded_toolhead is not reachable from its source");
}

TEST_CASE("multiACE projection rejects toolheads outside the U1 range", "[multiace][ams][regression]")
{
    CHECK_THROWS_WITH(project_inventory_to_ams(regression_inventory("r1", {regression_source("0", "0", {4})})),
                      "multiACE source contains an invalid U1 toolhead");
    CHECK_THROWS_WITH(project_inventory_to_ams(regression_inventory("r1", {regression_source("0", "0", {-1})})),
                      "multiACE source contains an invalid U1 toolhead");
}

TEST_CASE("multiACE live tray field application preserves profile-managed state", "[multiace][ams][regression]")
{
    LiveFieldTray     tray;
    AmsTrayProjection projection;
    projection.tray_id                  = "2";
    projection.source.rfid_uid          = "rfid-12";
    projection.source.material          = "PETG";
    projection.source.subtype           = "PETG Basic";
    projection.source.remaining_percent = 61;
    projection.color_rgba               = "010203FF";
    projection.exists                   = true;

    apply_projected_tray_live_fields(tray, projection, 3, 4, 5);

    CHECK(tray.id == "2");
    CHECK(tray.tag_uid == "rfid-12");
    CHECK(tray.type == "PETG");
    CHECK(tray.sub_brands == "PETG Basic");
    CHECK(tray.color == "010203FF");
    CHECK(tray.is_exists);
    CHECK(tray.remain == 61);
    CHECK(tray.road_position == 3);
    CHECK(tray.step_state == 4);
    CHECK(tray.rfid_state == 5);

    CHECK(tray.setting_id == "setting-id");
    CHECK(tray.filament_setting_id == "filament-profile-id");
    CHECK(tray.uuid == "profile-uuid");
    CHECK((tray.cols == std::vector<std::string>{"112233FF", "445566FF"}));
    CHECK(tray.cali_idx == 7);
}
