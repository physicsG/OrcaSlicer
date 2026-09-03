#ifndef slic3r_AceMmuRewrite_hpp_
#define slic3r_AceMmuRewrite_hpp_

// Route C: rewrite a sliced gcode for a Snapmaker U1 whose toolheads are fed by multiACE.
//
// The slicer emits LOGICAL tools - `T5` is the sixth project filament, on a machine with four
// heads - and knows nothing about ACE bays. This pass reads that file after export, plans
// which (head, bay) each filament lives in (`AceMmuPlan.hpp`), and writes a second file the
// machine can run: every `T<n>` becomes the physical head, an `ACE_SWAP_HEAD` is placed where
// a head must present another bay, and a preload block loads the first bays before the prime
// line. The slicing pipeline is untouched; the logical file stays as the preview's source.
//
// This is a port of multiACE's own printer-side preflight, which does the same job for files
// uploaded through its web UI. multiACE is GPL-3.0, github.com/decay71/multiACE; the
// specification is tag v0.99.8b, `multiace/tools/post_process_virtual_toolheads.py`:
// `rewrite_head_mode_to_file`, `inject_auto_load_to_file`, `scan_cooling_standbys`. Behaviour
// is ported, not code, and where this deliberately differs the reason is in
// docs/u1-webui/03-print-processing/09-route-c-plan.md §3.3 (rules R1-R11).
//
// Pure: no GUI, no Print, no printer. The caller hands over the topology and the per-filament
// facts it read from the config; this reads and writes files.

#include <cstdint>
#include <functional>
#include <iosfwd>
#include <stdexcept>
#include <string>
#include <vector>

#include "AceMmuPlan.hpp"

namespace Slic3r { namespace AceMmu {

struct RewriteFilament
{
    std::string colour;          // "#rrggbb", for messages and the plan the page reads
    std::string type;            // "PLA"
    double      diameter = 1.75; // mm
    double      density  = 1.24; // g/cm3
};

struct RewriteInput
{
    // The machine's own words for its switch: normal | head | multi. `normal` never rewrites.
    std::string mode = "head";
    // Per toolhead, from the printer preset (ace_head_unit / ace_head_capacity).
    std::vector<int> head_unit;     // ACE unit feeding the head; -1 = stock feeder
    std::vector<int> head_capacity; // bays the head can present; 1 = stock feeder
    // Per project filament, in filament order.
    std::vector<RewriteFilament> filaments;
    // flush_volumes_matrix (mm3, [from * n + to]) and flush_multiplier. Empty = no purge stamps.
    std::vector<float> flush_matrix;
    float              flush_multiplier = 1.f;
    // Optional: a layout to price instead of planning one (filament -> head, -1 = unused).
    std::vector<int> head_override;
    // Optional: per filament, the bay it must be drawn from (-1 = the planner's choice).
    // This is the cheap half of a re-map: a bay is one argument on each `ACE_SWAP_HEAD`,
    // so honouring it needs no re-planning and changes no swap count. Only meaningful on
    // an ACE-fed head; naming a bay for a filament on a stock feeder is refused rather
    // than ignored, because silently dropping a placement is how a plate prints in the
    // wrong colour. docs/u1-webui/03-print-processing/10-plan-choice.md
    std::vector<int> slot_override;
    std::int64_t     work_budget = 64ll * 1000 * 1000;
};

// What pass A reads out of the logical file.
struct ToolSequence
{
    int              initial = -1; // the tool the first `; Change Tool` marker selects
    std::vector<int> body;         // every body tool selection in print order, initial first
    std::vector<int> used;         // sorted, unique
    int              max_tool = -1;
    long             first_marker    = -1; // 0-based line numbers, -1 = absent
    long             first_extruding = -1;
    long             anchor          = -1; // where the preload block goes
};

struct RewriteResult
{
    bool         rewritten = false; // false: the file is fine as it is, nothing was written
    LoadingPlan  plan;
    ToolSequence sequence;
    int          heads = 0;
    // What was emitted.
    int    swaps            = 0; // ACE_SWAP_HEAD in the body (the preload block is free)
    int    stamped          = 0; // ACE_SET_PURGE LENGTH= lines
    int    dropped_standbys = 0; // temperature lines the replay blamed
    double purge_mm         = 0; // sum of the stamps
    double purge_g          = 0;
    double preflight_purge_mm = 0; // what multiACE's clamp(40,150,45%) policy would have stamped
    std::vector<int>              preload_slot; // per head, the bay preloaded; -1 = none
    std::vector<std::vector<int>> runs;         // per head, its filaments in first-use order
    std::string                   header_line;  // the "; multiACE plan:" line written
};

// Thrown when the plate cannot be rewritten. The message is for the operator.
struct RewriteRefusal : std::runtime_error
{
    using std::runtime_error::runtime_error;
};

// Pass A over the logical file.
ToolSequence scan_tool_sequence(std::istream& in);

// The planner's view of the topology. Throws RewriteRefusal for `multi` mode (gated) and for
// two heads on one unit (the planner would count the unit twice).
std::vector<PlanHead> plan_heads(const RewriteInput& in);

// The plan for this sequence: the optimiser, or the override priced. A plate whose used tools
// all sit on their own stock feeder is returned as the identity with zero swaps. Throws
// RewriteRefusal when the plate has more used filaments than places, with the counts.
LoadingPlan plan_for(const RewriteInput& in, const ToolSequence& seq, const std::vector<PlanHead>& heads);

// Whether `plan` changes anything about how the file would run: a used tool is not its own
// head, or sits on an ACE-fed head.
bool needs_rewrite(const RewriteInput& in, const ToolSequence& seq, const LoadingPlan& plan);

// The whole thing over streams (the input must be seekable: it is read three times). Writes
// nothing to `out` when the result says `rewritten == false`. `tick` is called every few
// thousand lines so a caller can cancel by throwing.
RewriteResult rewrite_gcode(std::istream& in, std::ostream& out, const RewriteInput& input,
                            const std::function<void()>& tick = {});

// Over files. `out_path` is created only when there is something to write.
RewriteResult rewrite_file(const std::string& in_path, const std::string& out_path, const RewriteInput& input,
                           const std::function<void()>& tick = {});

// The header line the bridge and the page read: "; multiACE plan: T0:H3S3 … swaps:N optimal:1".
std::string plan_header_line(const LoadingPlan& plan);
// The inverse. head_of / slot_of are sized to the highest filament named.
bool parse_plan_header(const std::string& line, LoadingPlan& plan);

// The slicer's own purge length for a pair, in mm of filament: matrix × multiplier ÷ area.
// 0 when the pair has no value, which means "no stamp - the machine's default applies".
double purge_length_mm(const RewriteInput& in, int from, int to);
// multiACE v0.99.8b's stamp for the same pair: clamp(40, 150, 0.45 × mm3 ÷ 2.405), multiplier
// applied upward only. Recorded beside ours, never written.
double preflight_purge_mm(const RewriteInput& in, int from, int to);
// "47.271" - three decimals, trailing zeros trimmed, locale-free.
std::string format_length(double mm);

}} // namespace Slic3r::AceMmu

#endif // slic3r_AceMmuRewrite_hpp_
