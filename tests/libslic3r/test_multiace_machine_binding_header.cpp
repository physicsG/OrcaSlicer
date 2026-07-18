#include <catch2/catch.hpp>

#include "slic3r/GUI/multiace/MultiAceMachineBinding.hpp"

#include <type_traits>

using namespace Slic3r::MultiAce;

static_assert(!std::is_copy_constructible_v<MultiAceMachineBinding>);
static_assert(!std::is_copy_assignable_v<MultiAceMachineBinding>);
static_assert(!std::is_move_constructible_v<MultiAceMachineBinding>);
static_assert(!std::is_move_assignable_v<MultiAceMachineBinding>);

TEST_CASE("multiACE machine binding keeps provider dispatch separate from the machine model", "[multiace][binding]")
{
    CHECK(std::is_same_v<MultiAceMachineBinding::Dispatcher, FilamentSourceBinding::Dispatcher>);
}
