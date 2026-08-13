#ifndef slic3r_AceMmuToolMap_hpp_
#define slic3r_AceMmuToolMap_hpp_

// A `T<n>` in the gcode is not a physical head. The U1 firmware resolves it through
// `print_task_config.extruder_map_table` — a logical-tool -> physical-extruder table that
// Snapmaker's *Print Preprocessing* page rewrites, one line at a time, immediately before
// starting a print:
//
//     SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=<logical> MAP_EXTRUDER=<physical>
//     SET_PRINT_USED_EXTRUDERS EXTRUDERS=<csv>
//
// (Confirmed on firmware 1.5.2.13: the live object carried
// `reprint_info.extruder_map_table = [0,1,1,0,...]` from an earlier print — a real,
// non-identity map that the page had written. Third-party firmware wraps the same command;
// see SnapmakerU1-Extended-Firmware's AFC-Lite `SET_MAP`.)
//
// The page chooses that table by matching the file's filaments against the spools it finds
// on the machine. For an ordinary plate a remap is a feature: it lets you print a file
// authored for head 0 using the spool that happens to sit in head 2.
//
// For a multiACE plate it is never right. Our tool numbers ARE head numbers — the plan
// assigned each filament to a head, and the ACE macros we emit (`ACE_SWAP_HEAD HEAD=n ...`)
// name that head directly. Remapping the tool changes without remapping the swaps
// desynchronises the two: the plate prints on the wrong heads and the ACE feeds a head that
// is no longer asking for it. So an ACE plate must reach the machine with the identity map.
//
// This finds the offending lines. What to do about them is policy and lives in the GUI.
//
// Pure/header-only (no GUI, no printer, no wx) so it unit-tests under tests/libslic3r.

#include <cctype>
#include <string>
#include <vector>

namespace Slic3r { namespace AceMmu {

// One `SET_PRINT_EXTRUDER_MAP` the printer was asked to apply.
struct ToolMapEntry
{
    int logical  = -1; // CONFIG_EXTRUDER — the T<n> in our gcode
    int physical = -1; // MAP_EXTRUDER    — the head the machine would actually use

    bool identity() const { return logical >= 0 && logical == physical; }
};

namespace detail {

// Value of KEY=... in `line` starting at `from`, or empty. Tolerates the quoting used by
// gcode macros (`KEY='3'`) as well as the bare form the web page emits.
inline std::string map_arg(const std::string& line, const std::string& key)
{
    // Match the key only at a token boundary, so MAP_EXTRUDER never satisfies a search for
    // the substring EXTRUDER.
    for (size_t at = line.find(key); at != std::string::npos; at = line.find(key, at + 1)) {
        if (at > 0 && (std::isalnum(static_cast<unsigned char>(line[at - 1])) || line[at - 1] == '_'))
            continue;
        size_t p = at + key.size();
        while (p < line.size() && std::isspace(static_cast<unsigned char>(line[p])))
            ++p;
        if (p >= line.size() || line[p] != '=')
            continue;
        ++p;
        while (p < line.size() && (std::isspace(static_cast<unsigned char>(line[p])) || line[p] == '\'' || line[p] == '"'))
            ++p;
        const size_t start = p;
        while (p < line.size() && !std::isspace(static_cast<unsigned char>(line[p])) && line[p] != '\'' && line[p] != '"')
            ++p;
        return line.substr(start, p - start);
    }
    return {};
}

inline bool parse_int(const std::string& s, int& out)
{
    if (s.empty())
        return false;
    for (char c : s)
        if (!std::isdigit(static_cast<unsigned char>(c)))
            return false;
    out = std::stoi(s);
    return true;
}

inline std::string upper(std::string s)
{
    for (char& c : s)
        c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return s;
}

} // namespace detail

// Every SET_PRINT_EXTRUDER_MAP in a batch of gcode, in the order the machine would apply
// them. `codes` may be one string per line, one string holding several newline-separated
// lines, or any mixture — the web page sends the latter. Lines that are not a well-formed
// SET_PRINT_EXTRUDER_MAP are ignored rather than guessed at: this decides whether to refuse
// a print, so a half-understood line must not become evidence.
inline std::vector<ToolMapEntry> parse_tool_map(const std::vector<std::string>& codes)
{
    std::vector<ToolMapEntry> out;
    for (const std::string& chunk : codes) {
        size_t pos = 0;
        while (pos <= chunk.size()) {
            const size_t eol  = chunk.find('\n', pos);
            std::string  line = chunk.substr(pos, eol == std::string::npos ? std::string::npos : eol - pos);
            pos               = (eol == std::string::npos) ? chunk.size() + 1 : eol + 1;

            const std::string up = detail::upper(line);
            if (up.find("SET_PRINT_EXTRUDER_MAP") == std::string::npos)
                continue;
            ToolMapEntry e;
            if (detail::parse_int(detail::map_arg(up, "CONFIG_EXTRUDER"), e.logical) &&
                detail::parse_int(detail::map_arg(up, "MAP_EXTRUDER"), e.physical))
                out.push_back(e);
        }
    }
    return out;
}

// The entries that would move a tool off its own head. Empty means the batch leaves the
// mapping alone or restates the identity, both of which are safe for an ACE plate.
inline std::vector<ToolMapEntry> non_identity_tool_map(const std::vector<std::string>& codes)
{
    std::vector<ToolMapEntry> out;
    for (const ToolMapEntry& e : parse_tool_map(codes))
        if (!e.identity())
            out.push_back(e);
    return out;
}

}} // namespace Slic3r::AceMmu

#endif // slic3r_AceMmuToolMap_hpp_
