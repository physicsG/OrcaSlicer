#include "AceMmuRewrite.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <map>
#include <set>
#include <sstream>

#include <boost/nowide/fstream.hpp>

namespace Slic3r { namespace AceMmu {

namespace {

// multiACE v0.99.8b, post_process_virtual_toolheads.py - the constants the port mirrors.
constexpr int    kStandbyMinC        = 170;   // STANDBY_MIN_EXTRUDE_C
constexpr double kPreflightMm3PerMm  = 2.405; // FILAMENT_MM3_PER_MM
constexpr double kPreflightTopupFrac = 0.45;  // PURGE_MATRIX_TOPUP_FRAC
constexpr double kPreflightMinMm     = 40.;   // PURGE_MATRIX_MIN_MM
constexpr double kPreflightMaxMm     = 150.;  // PURGE_MATRIX_MAX_MM
constexpr int    kFormatVersion      = 4;     // PP_FORMAT_VERSION
constexpr double kPi                 = 3.14159265358979323846;
constexpr long   kTickEvery          = 4096;

inline bool is_space(char c) { return std::isspace(static_cast<unsigned char>(c)) != 0; }
inline bool is_digit(char c) { return std::isdigit(static_cast<unsigned char>(c)) != 0; }
inline bool is_alnum(char c) { return std::isalnum(static_cast<unsigned char>(c)) != 0; }

std::string strip_cr(std::string s)
{
    while (!s.empty() && s.back() == '\r')
        s.pop_back();
    return s;
}

std::string trim(const std::string& s)
{
    size_t a = 0, b = s.size();
    while (a < b && is_space(s[a]))
        ++a;
    while (b > a && is_space(s[b - 1]))
        --b;
    return s.substr(a, b - a);
}

bool starts_with(const std::string& s, const char* p)
{
    const size_t n = std::strlen(p);
    return s.size() >= n && s.compare(0, n, p) == 0;
}

void skip_ws(const std::string& s, size_t& p)
{
    while (p < s.size() && is_space(s[p]))
        ++p;
}

bool parse_int_at(const std::string& s, size_t& p, int& out)
{
    size_t q = p;
    long   v = 0;
    while (q < s.size() && is_digit(s[q]) && q - p < 9) {
        v = v * 10 + (s[q] - '0');
        ++q;
    }
    if (q == p)
        return false;
    out = int(v);
    p   = q;
    return true;
}

// `; Change Tool<a> -> Tool<b> (layer n)` - the stock U1 template's marker. No space before
// the digit, because `[previous_extruder]` is legacy placeholder syntax; `\s*` takes zero.
bool parse_marker(const std::string& line, int& from, int& to)
{
    size_t p = 0;
    skip_ws(line, p);
    if (p >= line.size() || line[p] != ';')
        return false;
    ++p;
    skip_ws(line, p);
    if (line.compare(p, 11, "Change Tool") != 0)
        return false;
    p += 11;
    skip_ws(line, p);
    if (!parse_int_at(line, p, from))
        return false;
    skip_ws(line, p);
    if (line.compare(p, 2, "->") != 0)
        return false;
    p += 2;
    skip_ws(line, p);
    if (line.compare(p, 4, "Tool") != 0)
        return false;
    p += 4;
    skip_ws(line, p);
    return parse_int_at(line, p, to);
}

// `T<n>` and nothing else on the line (multiACE: ^T(\d{1,2})\s*$).
bool parse_bare_tool(const std::string& line, int& n)
{
    if (line.size() < 2 || line[0] != 'T' || !is_digit(line[1]))
        return false;
    size_t p = 1;
    int    v;
    if (!parse_int_at(line, p, v) || p > 3)
        return false;
    while (p < line.size() && is_space(line[p]))
        ++p;
    if (p != line.size())
        return false;
    n = v;
    return true;
}

bool is_temp_line(const std::string& line)
{
    return (starts_with(line, "M104") || starts_with(line, "M109")) && (line.size() == 4 || !is_alnum(line[4]));
}

struct Param
{
    size_t pos   = std::string::npos;
    size_t len   = 0;
    int    value = -1;
    bool   exact = false; // the token is <key><digits> and nothing more
    bool   found() const { return pos != std::string::npos; }
};

// The first `<key><digits…>` token at a token boundary, before any comment.
Param find_param(const std::string& line, char key)
{
    Param  out;
    size_t end = line.find(';');
    if (end == std::string::npos)
        end = line.size();
    size_t p = 0;
    while (p < end) {
        while (p < end && is_space(line[p]))
            ++p;
        const size_t start = p;
        while (p < end && !is_space(line[p]))
            ++p;
        if (p == start)
            break;
        if (line[start] == key && p - start >= 2 && is_digit(line[start + 1])) {
            size_t q = start + 1;
            int    v = -1;
            parse_int_at(line, q, v);
            out.pos   = start;
            out.len   = p - start;
            out.value = v;
            out.exact = (q == p);
            return out;
        }
    }
    return out;
}

bool parse_preextrude(const std::string& line, int& n)
{
    static const char* pfx = "SM_PRINT_PREEXTRUDE_FILAMENT INDEX=";
    if (!starts_with(line, pfx))
        return false;
    size_t p = std::strlen(pfx);
    int    v;
    if (!parse_int_at(line, p, v))
        return false;
    if (p < line.size() && !is_space(line[p]))
        return false;
    n = v;
    return true;
}

// A section boundary: a blank line, or a `;===== … =====` comment.
bool is_boundary(const std::string& t) { return t.empty() || (t[0] == ';' && t.find("=====") != std::string::npos); }

// A G0/G1 that advances the extruder: multiACE's locale-independent "printing has begun".
bool is_extruding_move(const std::string& t)
{
    if (!((starts_with(t, "G1") || starts_with(t, "G0")) && (t.size() == 2 || is_space(t[2]))))
        return false;
    size_t end = t.find(';');
    if (end == std::string::npos)
        end = t.size();
    size_t p = 0;
    while (p < end) {
        while (p < end && is_space(t[p]))
            ++p;
        const size_t start = p;
        while (p < end && !is_space(t[p]))
            ++p;
        if (p == start)
            break;
        if (t[start] == 'E' && p - start >= 2) {
            const double v = std::strtod(t.c_str() + start + 1, nullptr);
            return v > 0.;
        }
    }
    return false;
}

std::string lower(std::string s)
{
    for (char& c : s)
        c = char(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

double filament_area(const RewriteInput& in, int f)
{
    const double d = (f >= 0 && size_t(f) < in.filaments.size()) ? in.filaments[f].diameter : 1.75;
    return d > 0. ? kPi * 0.25 * d * d : 0.;
}

std::string filament_name(const RewriteInput& in, int f)
{
    std::string s = "filament " + std::to_string(f + 1);
    if (f >= 0 && size_t(f) < in.filaments.size()) {
        const RewriteFilament& fil = in.filaments[f];
        if (!fil.colour.empty() || !fil.type.empty())
            s += " (" + fil.colour + (fil.colour.empty() || fil.type.empty() ? "" : " ") + fil.type + ")";
    }
    return s;
}

// Everything the three passes share.
struct Ctx
{
    const RewriteInput& in;
    const ToolSequence& seq;
    const LoadingPlan&  plan;
    int                 heads;

    int nf() const { return int(in.filaments.size()); }
    bool planned(int n) const { return n >= 0 && n < nf() && n < int(plan.head_of.size()) && plan.head_of[n] >= 0; }
    bool ace_head(int h) const { return h >= 0 && h < heads && in.head_capacity[h] > 1; }

    // Which head a `T<n>` means. In the body every tool is logical. Before the body only the
    // initial tool is - the stock start gcode writes `T{initial_extruder}` and
    // `M104 T{initial_extruder} S…` for it, and `M104 S0 T<n> A0` for the physical heads it
    // shuts down. `logical` is the caller's judgement of which of those two the line is.
    int mapped_head(int n, bool in_body, bool logical) const
    {
        if (!planned(n))
            return -1;
        if (in_body)
            return plan.head_of[n];
        if (n == seq.initial && logical)
            return plan.head_of[n];
        if (n >= heads) // no physical head has this number
            return plan.head_of[n];
        return -1;
    }

    // A temperature line's `T` before its `S` (or with no `S`) is the template naming the
    // initial tool; `S… T…` is the writer's format and the physical shutdowns.
    static bool temp_line_is_logical(const Param& t, const Param& s) { return !s.found() || t.pos < s.pos; }
};

// Pass B: the standby replay. Returns the line numbers of temperature lines that leave the
// printing head below the extrusion minimum before it extrudes again - the only standbys
// that are dangerous once tools share a head. (multiACE scan_cooling_standbys.)
std::set<long> scan_standbys(std::istream& in, const Ctx& ctx)
{
    std::set<long>                    danger;
    std::map<int, int>                target;
    std::map<int, std::vector<long>>  cold;
    int                               active  = -1;
    bool                              in_body = false;
    std::string                       raw;
    long                              no = -1;
    while (std::getline(in, raw)) {
        ++no;
        const std::string line = strip_cr(raw);
        std::string       code = line;
        if (const size_t c = code.find(';'); c != std::string::npos)
            code.resize(c);
        code = trim(code);
        if (code.empty()) {
            int a, b;
            if (!in_body && parse_marker(line, a, b))
                in_body = true;
            continue;
        }
        int n;
        if (parse_bare_tool(code, n)) {
            const int h    = ctx.mapped_head(n, in_body, true);
            const int phys = h >= 0 ? h : (n < ctx.heads ? n : -1);
            if (phys >= 0)
                active = phys;
            continue;
        }
        if (is_temp_line(code)) {
            const Param s = find_param(code, 'S');
            if (!s.found())
                continue;
            const Param t = find_param(code, 'T');
            int         head = active;
            if (t.found()) {
                const int h = ctx.mapped_head(t.value, in_body, Ctx::temp_line_is_logical(t, s));
                head        = h >= 0 ? h : (t.value < ctx.heads ? t.value : -1);
            }
            if (head < 0)
                continue;
            target[head] = s.value;
            if (0 < s.value && s.value < kStandbyMinC)
                cold[head].push_back(no);
            else
                cold[head].clear();
            continue;
        }
        if (active >= 0 && is_extruding_move(code)) {
            const auto it = target.find(active);
            if (it != target.end() && 0 < it->second && it->second < kStandbyMinC)
                for (long l : cold[active])
                    danger.insert(l);
        }
    }
    return danger;
}

std::string preload_block(const Ctx& ctx, RewriteResult& res)
{
    // multiACE's own block, line for line (inject_auto_load_to_file at v0.99.8b), with the
    // plan line the bridge and the page read placed above it.
    std::string s;
    s += res.header_line + "\n";
    int count = 0;
    for (int h = 0; h < ctx.heads; ++h)
        if (res.preload_slot[h] >= 0)
            ++count;
    s += "; multiACE auto-load: load " + std::to_string(count) + " head(s)\n";
    s += "; multiACE processed: format=" + std::to_string(kFormatVersion) + "\n";
    s += "ACE_SET_PURGE RESET=1\n";
    for (int h = 0; h < ctx.heads; ++h)
        if (res.preload_slot[h] >= 0)
            s += "ACE_SWAP_HEAD HEAD=" + std::to_string(h) + " ACE=" + std::to_string(ctx.in.head_unit[h]) + " SLOT=" +
                 std::to_string(res.preload_slot[h]) + " INITIAL=1\n";
    s += "; multiACE auto-load: end\n";
    return s;
}

// Pass C.
void emit(std::istream& in, std::ostream& out, const Ctx& ctx, const std::set<long>& danger, RewriteResult& res,
          const std::function<void()>& tick)
{
    const RewriteInput& cfg = ctx.in;
    // What each head holds in the simulation: the filament, and the bay it came from.
    std::vector<int>  held(ctx.heads, -1);
    std::vector<bool> primed(ctx.heads, false);
    for (int h = 0; h < ctx.heads; ++h)
        if (res.preload_slot[h] >= 0)
            for (int f : res.runs[h])
                if (ctx.plan.slot_of[f] == res.preload_slot[h]) {
                    held[h] = f;
                    break;
                }

    const std::string block   = preload_block(ctx, res);
    bool              in_body = false;
    std::string       raw;
    long              no = -1;
    while (std::getline(in, raw)) {
        ++no;
        if (tick && (no % kTickEvery) == 0)
            tick();
        const std::string line = strip_cr(raw);
        if (no == ctx.seq.anchor)
            out << block;

        int a, b;
        if (!in_body && parse_marker(line, a, b)) {
            in_body = true;
            out << line << '\n';
            continue;
        }

        int n;
        if (parse_bare_tool(line, n)) {
            const int h = ctx.mapped_head(n, in_body, true);
            if (h < 0) {
                out << line << '\n';
                continue;
            }
            out << 'T' << h << '\n';
            if (!in_body) {
                if (ctx.ace_head(h))
                    primed[h] = true; // the start gcode's prime line primes the initial head
                continue;
            }
            if (!ctx.ace_head(h))
                continue;
            const int slot = ctx.plan.slot_of[n];
            if (held[h] == n)
                continue; // already presenting this bay (the preload, or a same-tool change)
            const int  from = held[h];
            const double mm = purge_length_mm(cfg, from, n);
            out << "; multiACE: head " << h << " must present ACE " << cfg.head_unit[h] << " slot " << slot << '\n';
            if (mm > 0.) {
                out << "ACE_SET_PURGE LENGTH=" << format_length(mm) << '\n';
                ++res.stamped;
                res.purge_mm += mm;
                res.purge_g += mm * filament_area(cfg, n) * cfg.filaments[n].density / 1000.;
            }
            res.preflight_purge_mm += preflight_purge_mm(cfg, from, n);
            out << "ACE_SWAP_HEAD HEAD=" << h << " ACE=" << cfg.head_unit[h] << " SLOT=" << slot << '\n';
            held[h] = n;
            ++res.swaps;
            continue;
        }

        if (is_temp_line(line)) {
            std::string   text = line;
            const Param   s    = find_param(text, 'S');
            const Param   t    = find_param(text, 'T');
            if (t.found() && t.exact) {
                const int h = ctx.mapped_head(t.value, in_body, Ctx::temp_line_is_logical(t, s));
                if (h >= 0)
                    text.replace(t.pos, t.len, "T" + std::to_string(h));
            }
            if (danger.count(no)) {
                out << "; multiACE dropped: " << trim(text) << "  ; would cool the printing head below " << kStandbyMinC
                    << " C\n";
                ++res.dropped_standbys;
            } else
                out << text << '\n';
            continue;
        }

        if (parse_preextrude(line, n)) {
            const int h = ctx.mapped_head(n, in_body, true);
            if (h < 0) {
                out << line << '\n';
                continue;
            }
            if (ctx.ace_head(h)) {
                if (primed[h])
                    continue; // a swap flushes; a prime on top of it stacks ooze on the tower
                primed[h] = true;
            }
            out << "SM_PRINT_PREEXTRUDE_FILAMENT INDEX=" << h << '\n';
            continue;
        }

        out << line << '\n';
    }
    if (ctx.seq.anchor >= 0 && no < ctx.seq.anchor)
        out << block; // cannot happen with a scanned sequence; kept so the block is never lost
}

void rewind(std::istream& in)
{
    in.clear();
    in.seekg(0, std::ios::beg);
}

} // namespace

// ---------------------------------------------------------------------------------------------

ToolSequence scan_tool_sequence(std::istream& in)
{
    ToolSequence seq;
    std::string  raw;
    long         no            = -1;
    long         last_boundary = -1;
    long         ext_boundary  = -1;
    long         first_huaqi   = -1;
    long         first_pre     = -1;
    bool         in_body       = false;
    while (std::getline(in, raw)) {
        ++no;
        const std::string line = strip_cr(raw);
        const std::string t    = trim(line);
        if (seq.first_extruding < 0) {
            if (is_boundary(t))
                last_boundary = no;
            else if (is_extruding_move(t)) {
                seq.first_extruding = no;
                ext_boundary        = last_boundary;
            }
        }
        if (first_huaqi < 0 && (line.find("\xe7\x94\xbb\xe8\xb5\xb7\xe5\xa7\x8b\xe7\xba\xbf") != std::string::npos ||
                                lower(line).find("draw the starting line") != std::string::npos))
            first_huaqi = no;
        int a, b;
        if (!in_body && parse_marker(line, a, b)) {
            in_body          = true;
            seq.first_marker = no;
            seq.initial      = b;
            continue;
        }
        if (first_pre < 0 && starts_with(line, "SM_PRINT_PREEXTRUDE_FILAMENT"))
            first_pre = no;
        int n;
        if (in_body && parse_bare_tool(line, n))
            seq.body.push_back(n);
    }
    const long structural = ext_boundary >= 0 ? ext_boundary : seq.first_extruding;
    for (long cand : {structural, first_huaqi, seq.first_marker, first_pre})
        if (cand >= 0) {
            seq.anchor = cand;
            break;
        }
    seq.used = seq.body;
    std::sort(seq.used.begin(), seq.used.end());
    seq.used.erase(std::unique(seq.used.begin(), seq.used.end()), seq.used.end());
    seq.max_tool = seq.used.empty() ? -1 : seq.used.back();
    return seq;
}

std::vector<PlanHead> plan_heads(const RewriteInput& in)
{
    if (in.mode == "multi")
        throw RewriteRefusal("This printer is in Combined ACE mode, which this version cannot slice for yet. "
                             "Switch the printer to per-toolhead mode, or print without the ACE.");
    if (in.mode != "head")
        throw RewriteRefusal("Unknown ACE mode \"" + in.mode + "\".");
    const size_t heads = in.head_capacity.size();
    if (heads == 0 || in.head_unit.size() != heads)
        throw RewriteRefusal("The printer preset carries no toolhead topology.");
    std::vector<PlanHead> out;
    std::map<int, int>    unit_owner;
    for (size_t h = 0; h < heads; ++h) {
        PlanHead ph;
        ph.idx      = int(h);
        ph.capacity = std::max(1, in.head_capacity[h]);
        ph.ace      = ph.capacity > 1;
        ph.ace_unit = ph.ace ? in.head_unit[h] : -1;
        if (ph.ace && ph.ace_unit < 0)
            throw RewriteRefusal("Toolhead " + std::to_string(h + 1) + " is ACE-fed but no ACE unit is chosen for it.");
        if (ph.ace) {
            auto it = unit_owner.find(ph.ace_unit);
            if (it != unit_owner.end())
                throw RewriteRefusal("Toolheads " + std::to_string(it->second + 1) + " and " + std::to_string(h + 1) +
                                     " share ACE " + std::to_string(ph.ace_unit + 1) +
                                     ", which this version cannot plan for yet. Give each ACE-fed toolhead its own unit.");
            unit_owner[ph.ace_unit] = int(h);
        }
        out.push_back(ph);
    }
    return out;
}

LoadingPlan plan_for(const RewriteInput& in, const ToolSequence& seq, const std::vector<PlanHead>& heads)
{
    const int n = int(in.filaments.size());
    if (seq.first_marker < 0 || seq.body.empty())
        throw RewriteRefusal("The G-code has no tool change markers; nothing to plan.");
    if (seq.max_tool >= n)
        throw RewriteRefusal("The G-code selects T" + std::to_string(seq.max_tool) + " but the project has only " +
                             std::to_string(n) + " filament(s).");

    LoadingPlan plan;
    if (!in.head_override.empty()) {
        if (int(in.head_override.size()) != n)
            throw RewriteRefusal("The chosen layout names " + std::to_string(in.head_override.size()) +
                                 " filaments; the project has " + std::to_string(n) + ".");
        plan = evaluate_assignment(heads, seq.body, n, in.head_override);
        if (!plan.feasible) {
            std::string missing;
            for (int t : seq.used)
                if (t < int(plan.head_of.size()) && plan.head_of[t] < 0)
                    missing += (missing.empty() ? "" : ", ") + filament_name(in, t);
            throw RewriteRefusal("The chosen layout leaves " + (missing.empty() ? std::string("a filament") : missing) +
                                 " without a place.");
        }
        return plan;
    }

    // An ordinary plate: every used tool has its own stock feeder. Leave it exactly where it is
    // rather than let a tie-break move it - the plain path must not change (06 §3.7).
    bool identity_ok = true;
    for (int t : seq.used)
        if (t >= int(heads.size()) || heads[t].ace)
            identity_ok = false;
    if (identity_ok) {
        std::vector<int> head_of(n, -1);
        for (int t : seq.used)
            head_of[t] = t;
        plan = evaluate_assignment(heads, seq.body, n, head_of);
        if (plan.feasible) {
            plan.optimal = true; // zero swaps: nothing beats it
            return plan;
        }
    }

    plan = plan_loading(heads, seq.body, n, {}, in.work_budget);
    if (!plan.feasible) {
        int feeders = 0, slots = 0;
        for (const PlanHead& h : heads)
            (h.ace ? slots : feeders) += h.ace ? h.capacity : 1;
        // The least-used filaments are the cheapest to drop.
        std::map<int, int> uses;
        for (int t : seq.body)
            ++uses[t];
        std::vector<std::pair<int, int>> by_use(uses.begin(), uses.end());
        std::sort(by_use.begin(), by_use.end(), [](auto& a, auto& b) { return a.second != b.second ? a.second < b.second : a.first < b.first; });
        const int over = int(seq.used.size()) - (feeders + slots);
        std::string drop;
        for (int i = 0; i < over && i < int(by_use.size()); ++i)
            drop += (drop.empty() ? "" : ", ") + filament_name(in, by_use[i].first) + " (" + std::to_string(by_use[i].second) +
                    (by_use[i].second == 1 ? " use)" : " uses)");
        throw RewriteRefusal("This plate uses " + std::to_string(seq.used.size()) + " filaments, but this printer has " +
                             std::to_string(feeders + slots) + " places for them - " + std::to_string(feeders) +
                             " stock feeder(s) and " + std::to_string(slots) + " ACE slot(s)." +
                             (drop.empty() ? "" : " Cheapest to drop: " + drop + "."));
    }
    return plan;
}

bool needs_rewrite(const RewriteInput& in, const ToolSequence& seq, const LoadingPlan& plan)
{
    for (int t : seq.used) {
        if (t >= int(plan.head_of.size()))
            return true;
        const int h = plan.head_of[t];
        if (h != t)
            return true;
        if (h >= 0 && h < int(in.head_capacity.size()) && in.head_capacity[h] > 1)
            return true;
    }
    return false;
}

std::string plan_header_line(const LoadingPlan& plan)
{
    std::string s = "; multiACE plan:";
    for (size_t i = 0; i < plan.head_of.size(); ++i) {
        if (plan.head_of[i] < 0)
            continue;
        const int slot = i < plan.slot_of.size() ? plan.slot_of[i] : 0;
        s += " T" + std::to_string(i) + ":H" + std::to_string(plan.head_of[i]) + "S" + std::to_string(std::max(0, slot));
    }
    s += " swaps:" + std::to_string(plan.swaps) + " optimal:" + (plan.optimal ? "1" : "0");
    return s;
}

bool parse_plan_header(const std::string& line, LoadingPlan& plan)
{
    static const char* pfx = "; multiACE plan:";
    const size_t at = line.find(pfx);
    if (at == std::string::npos || line.find('{') != std::string::npos)
        return false;
    std::istringstream is(line.substr(at + std::strlen(pfx)));
    std::string        tok;
    LoadingPlan        out;
    bool               any = false;
    while (is >> tok) {
        if (tok.size() > 1 && tok[0] == 'T' && is_digit(tok[1])) {
            size_t p = 1;
            int    f, h, s;
            if (!parse_int_at(tok, p, f) || p >= tok.size() || tok[p] != ':' || ++p >= tok.size() || tok[p] != 'H' ||
                !parse_int_at(tok, ++p, h) || p >= tok.size() || tok[p] != 'S' || !parse_int_at(tok, ++p, s))
                return false;
            if (size_t(f) >= out.head_of.size()) {
                out.head_of.resize(f + 1, -1);
                out.slot_of.resize(f + 1, -1);
            }
            out.head_of[f] = h;
            out.slot_of[f] = s;
            any            = true;
        } else if (starts_with(tok, "swaps:")) {
            size_t p = 6;
            if (!parse_int_at(tok, p, out.swaps))
                return false;
        } else if (starts_with(tok, "optimal:")) {
            out.optimal = tok.size() > 8 && tok[8] == '1';
        }
    }
    if (!any)
        return false;
    out.feasible = true;
    plan         = out;
    return true;
}

double purge_length_mm(const RewriteInput& in, int from, int to)
{
    const size_t n = in.filaments.size();
    if (from < 0 || to < 0 || from == to || size_t(from) >= n || size_t(to) >= n || in.flush_matrix.size() != n * n)
        return 0.;
    const double vol  = double(in.flush_matrix[size_t(from) * n + size_t(to)]) * double(in.flush_multiplier);
    const double area = filament_area(in, to);
    return (vol > 0. && area > 0.) ? vol / area : 0.;
}

double preflight_purge_mm(const RewriteInput& in, int from, int to)
{
    const size_t n = in.filaments.size();
    if (from < 0 || to < 0 || from == to || size_t(from) >= n || size_t(to) >= n || in.flush_matrix.size() != n * n)
        return 0.;
    const double raw = double(in.flush_matrix[size_t(from) * n + size_t(to)]) * std::max(1.0, double(in.flush_multiplier));
    double       mm  = raw / kPreflightMm3PerMm * kPreflightTopupFrac;
    mm               = std::max(kPreflightMinMm, std::min(kPreflightMaxMm, mm));
    return std::round(mm);
}

std::string format_length(double mm)
{
    if (!(mm > 0.))
        return "0";
    const long long milli = std::llround(mm * 1000.);
    std::string     s     = std::to_string(milli / 1000);
    long long       frac  = milli % 1000;
    if (frac != 0) {
        std::string f = std::to_string(frac);
        while (f.size() < 3)
            f = "0" + f;
        while (!f.empty() && f.back() == '0')
            f.pop_back();
        s += "." + f;
    }
    return s;
}

RewriteResult rewrite_gcode(std::istream& in, std::ostream& out, const RewriteInput& input, const std::function<void()>& tick)
{
    RewriteResult res;
    res.heads = int(input.head_capacity.size());
    if (input.mode == "normal")
        return res; // R10: stock feeders only; the file is the file

    rewind(in);
    res.sequence = scan_tool_sequence(in);
    if (tick)
        tick();
    const std::vector<PlanHead> heads = plan_heads(input);
    res.plan                          = plan_for(input, res.sequence, heads);
    if (!needs_rewrite(input, res.sequence, res.plan))
        return res;
    if (res.sequence.anchor < 0)
        throw RewriteRefusal("The G-code has no place for the ACE preload: no extruding move, tool change or prime was found.");

    // Runs per head in first-use order, and what each ACE head is preloaded with: the bay of
    // the first filament it prints (the planner assigns slots in first-use order, so slot 0).
    res.runs.assign(res.heads, {});
    res.preload_slot.assign(res.heads, -1);
    for (int t : res.sequence.body) {
        const int h = res.plan.head_of[t];
        if (h < 0 || h >= res.heads)
            continue;
        auto& run = res.runs[h];
        if (std::find(run.begin(), run.end(), t) == run.end())
            run.push_back(t);
        if (input.head_capacity[h] > 1 && res.preload_slot[h] < 0)
            res.preload_slot[h] = res.plan.slot_of[t];
    }
    res.header_line = plan_header_line(res.plan);

    Ctx ctx{input, res.sequence, res.plan, res.heads};
    rewind(in);
    const std::set<long> danger = scan_standbys(in, ctx);
    if (tick)
        tick();
    rewind(in);
    emit(in, out, ctx, danger, res, tick);
    res.rewritten = true;
    return res;
}

RewriteResult rewrite_file(const std::string& in_path, const std::string& out_path, const RewriteInput& input,
                           const std::function<void()>& tick)
{
    boost::nowide::ifstream in(in_path, std::ios::binary);
    if (!in.is_open())
        throw RewriteRefusal("Cannot open the G-code file " + in_path + ".");

    // Decide first, so the sibling is only ever created with content in it.
    RewriteResult probe;
    probe.heads = int(input.head_capacity.size());
    if (input.mode == "normal")
        return probe;
    probe.sequence = scan_tool_sequence(in);
    probe.plan     = plan_for(input, probe.sequence, plan_heads(input));
    if (!needs_rewrite(input, probe.sequence, probe.plan))
        return probe;

    boost::nowide::ofstream out(out_path, std::ios::binary | std::ios::trunc);
    if (!out.is_open())
        throw RewriteRefusal("Cannot write the rewritten G-code to " + out_path + ".");
    RewriteResult res = rewrite_gcode(in, out, input, tick);
    out.close();
    if (!out)
        throw RewriteRefusal("Writing the rewritten G-code to " + out_path + " failed.");
    return res;
}

}} // namespace Slic3r::AceMmu
