#ifndef slic3r_PrinterWebView_hpp_
#define slic3r_PrinterWebView_hpp_


#include "wx/artprov.h"
#include "wx/cmdline.h"
#include "wx/notifmsg.h"
#include "wx/settings.h"
#include <wx/webview.h>
#include <wx/string.h>

#if wxUSE_WEBVIEW_EDGE
#include "wx/msw/webview_edge.h"
#endif

#include "wx/webviewarchivehandler.h"
#include "wx/webviewfshandler.h"
#include "wx/numdlg.h"
#include "wx/infobar.h"
#include "wx/filesys.h"
#include "wx/fs_arc.h"
#include "wx/fs_mem.h"
#include "wx/stdpaths.h"
#include <wx/panel.h>
#include <wx/button.h>
#include <wx/tbarbase.h>
#include "wx/textctrl.h"
#include <wx/timer.h>


namespace Slic3r {
namespace GUI {


class PrinterWebView : public wxPanel{
public:
    PrinterWebView(wxWindow *parent);
    virtual ~PrinterWebView();

    void load_url(wxString& url, wxString apikey = "");

    // The Device tab can show either implementation: the shipped Flutter page
    // or the reconstruction in resources/web/device_page. Both are reachable
    // from a switcher above the webview; only one is loaded at a time, because
    // two live Device pages would open two MQTT sessions to the same printer.
    void show_surface(bool reconstructed);
    bool showing_reconstructed() const { return m_reconstructed; }
    void UpdateState();
    void OnClose(wxCloseEvent& evt);
    void OnError(wxWebViewEvent& evt);
    void OnLoaded(wxWebViewEvent& evt);
    void OnScriptMessage(wxWebViewEvent& evt);
    void reload();
    void update_mode();
    bool isSnapmakerPage();
    void sendMessage(const std::string& msg);
    wxWebView* get_browser() const { return m_browser; }

private:
    void SendAPIKey();

    void build_switcher(wxSizer* topsizer);
    void update_switcher();

    wxWebView* m_browser;
    wxPanel*   m_switcher   = nullptr;
    wxButton*  m_btn_original = nullptr;
    wxButton*  m_btn_rebuilt  = nullptr;
    bool       m_reconstructed = false;
    long m_zoomFactor;
    wxString m_apikey;

    // DECLARE_EVENT_TABLE()
};

} // GUI
} // Slic3r

#endif /* slic3r_Tab_hpp_ */
