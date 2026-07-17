#include <catch2/catch.hpp>

#include "libslic3r/MultiAceAmsModel.hpp"

#include <atomic>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

using namespace Slic3r::MultiAce;

namespace {

FilamentSource source(std::string        unit,
                      std::string        slot,
                      SourceState        state               = SourceState::Ready,
                      std::string        material            = "PLA",
                      std::string        color               = "#D52332",
                      std::vector<int>   reachable_toolheads = {0},
                      std::optional<int> loaded_toolhead     = std::nullopt)
{
    FilamentSource result;
    result.id                  = SourceId{"multiace", std::move(unit), std::move(slot)};
    result.rfid_uid            = "rfid-" + result.id.unit_id + '-' + result.id.slot_id;
    result.material            = std::move(material);
    result.subtype             = result.material + " Basic";
    result.brand               = "Snapmaker";
    result.color               = std::move(color);
    result.remaining_percent   = 75;
    result.metadata_origin     = SourceMetadataOrigin::RFID;
    result.state               = state;
    result.reachable_toolheads = std::move(reachable_toolheads);
    result.loaded_toolhead     = loaded_toolhead;
    return result;
}

InventorySnapshot inventory(std::string revision, std::vector<FilamentSource> sources)
{
    return {SUPPORTED_SCHEMA_VERSION, std::move(revision), std::move(sources)};
}

struct FakeTray
{
    std::string           id;
    std::string           tag_uid;
    std::string           type;
    std::string           sub_brands;
    std::string           color;
    std::string           uuid;
    int                   remain         = 0;
    bool                  is_exists      = false;
    bool                  rfid_read_done = false;
    ProjectedRoadPosition road_position  = ProjectedRoadPosition::Tray;
    ProjectedStepState    step_state     = ProjectedStepState::Init;
};

struct FakeAms
{
    std::string                      id;
    int                              nozzle       = -1;
    int                              type         = 1;
    bool                             is_exists    = false;
    int                              humidity     = 5;
    int                              humidity_raw = -1;
    std::optional<double>            current_temperature;
    int                              left_dry_time = 0;
    std::map<std::string, FakeTray*> tray_list;
};

struct FakeAmsTraits
{
    using AmsType  = FakeAms;
    using TrayType = FakeTray;

    static std::unique_ptr<FakeAms> create_ams(const AmsUnitProjection& projection)
    {
        auto ams    = std::make_unique<FakeAms>();
        ams->id     = projection.ams_id;
        ams->nozzle = projection.nozzle;
        return ams;
    }

    static std::unique_ptr<FakeTray> create_tray(const AmsTrayProjection& projection)
    {
        auto tray = std::make_unique<FakeTray>();
        tray->id  = projection.tray_id;
        return tray;
    }

    static std::map<std::string, FakeTray*>& tray_list(FakeAms& ams) { return ams.tray_list; }

    static void update_ams(FakeAms& ams, const AmsUnitProjection& projection)
    {
        ams.id                  = projection.ams_id;
        ams.nozzle              = projection.nozzle;
        ams.type                = 1;
        ams.is_exists           = true;
        ams.humidity            = projection.humidity_level;
        ams.humidity_raw        = projection.humidity_raw;
        ams.current_temperature = projection.current_temperature;
        ams.left_dry_time       = projection.dryer_remaining_seconds;
    }

    static void update_tray(FakeTray& tray, const AmsTrayProjection& projection)
    {
        tray.id         = projection.tray_id;
        tray.tag_uid    = projection.source.rfid_uid;
        tray.type       = projection.source.material;
        tray.sub_brands = projection.source.subtype.empty() ? projection.source.brand : projection.source.subtype;
        tray.color      = projection.color_rgba;
        tray.uuid.clear();
        tray.remain         = projection.source.remaining_percent.value_or(0);
        tray.is_exists      = projection.exists;
        tray.rfid_read_done = projection.rfid_read_done;
        tray.road_position  = projection.road_position;
        tray.step_state     = projection.step_state;
    }
};

using TestMachineModel = BasicMultiAceAmsModel<FakeAmsTraits>;

struct LocalAmsTarget
{
    std::map<std::string, FakeAms*> ams_list;
    long                            ams_exist_bits      = 0;
    long                            tray_exist_bits     = 0;
    long                            tray_is_bbl_bits    = 0;
    long                            tray_read_done_bits = 0;
    long                            tray_reading_bits   = 0;
    bool                            is_ams_need_update  = false;

    AmsModelTarget<FakeAms> target()
    {
        return {ams_list, ams_exist_bits, tray_exist_bits, tray_is_bbl_bits, tray_read_done_bits, tray_reading_bits, is_ams_need_update};
    }
};

} // namespace

TEST_CASE("multiACE inventory projects deterministically into AMS units", "[multiace][ams]")
{
    FilamentSource unit_two          = source("2", "1", SourceState::Loading, "PETG", "11223344", {1, 2});
    unit_two.humidity_percent        = 63;
    unit_two.temperature_c           = 31.0;
    unit_two.dryer_remaining_minutes = 12;

    FilamentSource unit_one_loaded   = source("1", "1", SourceState::Ready, "PLA", "#abcdef", {0}, 0);
    unit_one_loaded.humidity_percent = 42;
    unit_one_loaded.temperature_c    = 27.0;

    FilamentSource unit_one_empty = source("1", "0", SourceState::Empty, "", "invalid", {0});
    unit_one_empty.rfid_uid.clear();
    unit_one_empty.metadata_origin = SourceMetadataOrigin::Unknown;
    unit_one_empty.remaining_percent.reset();
    unit_one_empty.temperature_c = 29.0;

    const AmsInventoryProjection projection = project_inventory_to_ams(inventory("revision-2", {unit_two, unit_one_loaded, unit_one_empty}));

    REQUIRE(projection.units.size() == 2);
    CHECK(projection.units[0].ams_id == "1");
    CHECK(projection.units[1].ams_id == "2");

    const AmsUnitProjection& unit_one = projection.units[0];
    CHECK(unit_one.nozzle == 0);
    CHECK(unit_one.humidity_raw == 42);
    CHECK(unit_one.humidity_level == 3);
    REQUIRE(unit_one.current_temperature.has_value());
    CHECK(*unit_one.current_temperature == Approx(28.0));
    REQUIRE(unit_one.trays.size() == 2);
    CHECK(unit_one.trays[0].tray_id == "0");
    CHECK_FALSE(unit_one.trays[0].exists);
    CHECK(unit_one.trays[0].color_rgba.empty());
    CHECK(unit_one.trays[1].color_rgba == "ABCDEFFF");
    CHECK(unit_one.trays[1].road_position == ProjectedRoadPosition::Hotend);
    CHECK(unit_one.trays[1].step_state == ProjectedStepState::Completed);

    const AmsUnitProjection& unit_two_projection = projection.units[1];
    CHECK(unit_two_projection.nozzle == -1);
    CHECK(unit_two_projection.dryer_remaining_seconds == 720);
    CHECK(unit_two_projection.trays[0].color_rgba == "11223344");
    CHECK(unit_two_projection.trays[0].road_position == ProjectedRoadPosition::Tube);
    CHECK(unit_two_projection.trays[0].step_state == ProjectedStepState::Loading);

    CHECK((projection.ams_exist_bits & (1L << 1)) != 0);
    CHECK((projection.ams_exist_bits & (1L << 2)) != 0);
    CHECK((projection.tray_exist_bits & (1L << 4)) == 0);
    CHECK((projection.tray_exist_bits & (1L << 5)) != 0);
    CHECK((projection.tray_read_done_bits & (1L << 5)) != 0);
}

TEST_CASE("multiACE AMS projection rejects invalid inherited topology", "[multiace][ams]")
{
    SECTION("duplicate slot")
    {
        CHECK_THROWS_WITH(project_inventory_to_ams(inventory("r1", {source("0", "0"), source("0", "0")})),
                          "multiACE inventory contains duplicate unit and slot topology");
    }

    SECTION("noncanonical identifiers")
    {
        CHECK_THROWS_WITH(project_inventory_to_ams(inventory("r1", {source("01", "0")})),
                          "multiACE unit_id must be a canonical decimal integer");
    }

    SECTION("slot outside ACE range")
    {
        CHECK_THROWS_WITH(project_inventory_to_ams(inventory("r1", {source("0", "4")})), "multiACE slot_id must be between 0 and 3");
    }

    SECTION("mask capacity")
    {
        CHECK_THROWS_WITH(project_inventory_to_ams(inventory("r1", {source("2147483647", "0")})),
                          "multiACE unit and slot exceed the inherited AMS bit-mask capacity");
    }

    SECTION("loaded head is not reachable")
    {
        CHECK_THROWS_WITH(project_inventory_to_ams(inventory("r1", {source("0", "0", SourceState::Ready, "PLA", "FFFFFF", {1}, 2)})),
                          "multiACE loaded_toolhead is not reachable from its source");
    }

    SECTION("other provider")
    {
        FilamentSource other = source("0", "0");
        other.id.provider    = "other";
        CHECK_THROWS_WITH(project_inventory_to_ams(inventory("r1", {other})), "AMS projection only accepts multiace sources");
    }
}

TEST_CASE("multiACE model preserves pointers and native AMS entries", "[multiace][ams]")
{
    LocalAmsTarget target;
    FakeAms        native_ams;
    native_ams.id     = "5";
    native_ams.nozzle = 3;
    target.ams_list.emplace("5", &native_ams);
    target.ams_exist_bits      = 1L << 5;
    target.tray_exist_bits     = 1L << 20;
    target.tray_read_done_bits = 1L << 20;

    {
        TestMachineModel model(target.target());
        model.apply(inventory("r1", {source("0", "0"), source("0", "1", SourceState::Ready, "PETG", "00FF00", {1})}));

        REQUIRE(target.ams_list.size() == 2);
        CHECK(target.ams_list.at("5") == &native_ams);
        FakeAms*  unit_pointer = target.ams_list.at("0");
        FakeTray* tray_pointer = unit_pointer->tray_list.at("0");
        CHECK(unit_pointer->nozzle == -1);
        CHECK(tray_pointer->type == "PLA");
        CHECK(tray_pointer->color == "D52332FF");
        CHECK(tray_pointer->uuid.empty());
        CHECK(tray_pointer->remain == 75);
        CHECK(tray_pointer->is_exists);
        CHECK(tray_pointer->rfid_read_done);

        const AmsSourceMetadata* metadata = model.source_metadata("0", "0");
        REQUIRE(metadata != nullptr);
        CHECK(metadata->inventory_revision == "r1");
        CHECK(metadata->source.id.str() == "multiace:0:0");

        const std::optional<AmsSourceSlot> source_slot = model.slot_for_source(SourceId{"multiace", "0", "1"});
        REQUIRE(source_slot.has_value());
        CHECK(source_slot->ams_id == "0");
        CHECK(source_slot->tray_id == "1");

        model.apply(inventory("r2", {source("0", "0", SourceState::Offline, "ABS", "#010203", {0}),
                                     source("1", "2", SourceState::Ready, "PLA", "FFFFFF", {2}, 2)}));

        CHECK(target.ams_list.at("0") == unit_pointer);
        CHECK(target.ams_list.at("0")->tray_list.at("0") == tray_pointer);
        CHECK(tray_pointer->type == "ABS");
        CHECK(tray_pointer->color == "010203FF");
        CHECK(tray_pointer->is_exists);
        CHECK(tray_pointer->road_position == ProjectedRoadPosition::Tray);
        CHECK(target.ams_list.at("0")->tray_list.count("1") == 0);
        CHECK(target.ams_list.count("1") == 1);
        CHECK(model.revision() == "r2");

        CHECK((target.ams_exist_bits & (1L << 5)) != 0);
        CHECK((target.tray_exist_bits & (1L << 20)) != 0);
        CHECK((target.ams_exist_bits & 1L) != 0);
        CHECK((target.ams_exist_bits & (1L << 1)) != 0);

        model.clear();
        CHECK(target.ams_list.size() == 1);
        CHECK(target.ams_list.at("5") == &native_ams);
        CHECK(target.ams_exist_bits == (1L << 5));
        CHECK(target.tray_exist_bits == (1L << 20));
        CHECK(target.tray_read_done_bits == (1L << 20));
    }
}

TEST_CASE("multiACE model preserves overlapping external mask ownership", "[multiace][ams]")
{
    LocalAmsTarget target;
    target.ams_exist_bits      = 1L;
    target.tray_exist_bits     = 1L;
    target.tray_read_done_bits = 1L;

    TestMachineModel model(target.target());
    model.apply(inventory("r1", {source("0", "0")}));
    model.clear();

    CHECK(target.ams_exist_bits == 1L);
    CHECK(target.tray_exist_bits == 1L);
    CHECK(target.tray_read_done_bits == 1L);
}

TEST_CASE("multiACE model rejects native AMS collisions", "[multiace][ams]")
{
    LocalAmsTarget target;
    FakeAms        native_ams;
    native_ams.id = "0";
    target.ams_list.emplace("0", &native_ams);

    TestMachineModel model(target.target());
    CHECK_THROWS_WITH(model.apply(inventory("r1", {source("0", "0")})),
                      "multiACE AMS unit ID collides with an existing machine AMS entry: 0");
    CHECK(target.ams_list.at("0") == &native_ams);
}

TEST_CASE("multiACE model enforces owner-thread access", "[multiace][ams]")
{
    LocalAmsTarget    target;
    TestMachineModel  model(target.target());
    std::atomic<bool> rejected{false};

    std::thread worker([&] {
        try {
            (void) model.revision();
        } catch (const std::logic_error&) {
            rejected = true;
        }
    });
    worker.join();

    CHECK(rejected.load());
}
