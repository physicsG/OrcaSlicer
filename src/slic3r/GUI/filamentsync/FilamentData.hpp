#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include <wx/colour.h>

#include "libslic3r/MixedFilament.hpp"
#include "libslic3r/FilamentColorLibrary.hpp"

namespace Slic3r
{
namespace GUI
{
constexpr double g_lumR = 0.299;
constexpr double g_lumG = 0.587;
constexpr double g_lumB = 0.114;
constexpr int    g_luminanceThreshold = 140;
constexpr const char* g_defaultFilamentColor = "#26A69A";

struct FilamentData
{
    // 0-based index from the filament list; used for matching with machine filaments
    unsigned int m_index   = 0;
    std::string  m_name;
    std::string  m_type;
    FilamentColor m_color;
    // Optional display label (e.g. "T1 · PLA", "A1-S2 · PETG"); when set, the picker
    // shows this instead of the bare type. Does not affect matching (which uses
    // m_type/m_name). Used to surface the U1-toolhead / ACE-slot source.
    std::string  m_label;
    // When true, this is an explicit, selectable "Assign None" action (unmap the
    // project filament). The picker normally ignores clicks on NONE-typed rows
    // (they represent empty machine slots); this flag opts a row back into being
    // clickable without changing that behaviour for other printers.
    bool         m_assign_none = false;
    // When true, the row is shown for context but greyed and not selectable (e.g. a
    // U1 toolhead that is fed by the ACE — map the ACE slot instead of the head).
    bool         m_disabled = false;
};

struct MixedFilamentPreviewInfo
{
    int              m_virtual_filament_id = 0;
    MixedFilament    m_config;
};

inline bool isDarkColour(const wxColour& c)
{
    return (c.Red() * g_lumR + c.Green() * g_lumG + c.Blue() * g_lumB) < g_luminanceThreshold;
}

inline wxColour getTextColour(const wxColour& bg)
{
    return isDarkColour(bg) ? wxColour(255, 255, 255) : wxColour(0, 0, 0);
}

inline bool is_none_filament(const FilamentData& fd)
{
    return fd.m_type.empty() || fd.m_type == "NONE";
}

inline wxColour getMainColor(const FilamentColor& data)
{
    const std::string hex = data.PrimaryColor();
    wxColour c(hex);
    return c.IsOk() ? c : wxColour(g_defaultFilamentColor);
}

inline std::vector<wxColour> getAllColors(const FilamentColor& data)
{
    std::vector<wxColour> result;
    result.reserve(data.colors.size());
    for (const std::string& hex : data.colors) {
        wxColour c(hex);
        result.push_back(c.IsOk() ? c : wxColour(g_defaultFilamentColor));
    }
    return result;
}


using FilamentInfoCallback = std::function<void(const FilamentData& data)>;

} // namespace GUI
} // namespace Slic3r
