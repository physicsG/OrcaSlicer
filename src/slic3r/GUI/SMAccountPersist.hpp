#ifndef slic3r_GUI_SMAccountPersist_hpp_
#define slic3r_GUI_SMAccountPersist_hpp_

// Persist the Snapmaker account across restarts. The account (token/id/account/
// name/icon) is otherwise kept only in memory (GUI_App::m_login_userinfo) and is
// never written to disk, so every launch starts logged out. These helpers save it
// to app_config on login, restore it at startup, and clear it on logout.
//
// Deliberately a tiny standalone header (not GUI_App.hpp, which ~hundreds of TUs
// include) so touching login persistence doesn't trigger a full rebuild.
//
// NOTE: stores the bearer token in plaintext app_config (matches how this fork
// stores other settings). An OS keychain would be more secure — future work.

namespace Slic3r { namespace GUI {

// Write the current in-memory Snapmaker account to app_config (and save()).
void sm_persist_login();

// Restore the Snapmaker account from app_config into memory at startup. No-op if
// no token was saved. Does not re-validate the token against the server; a stale
// token simply fails on the next API call and the user re-logs in.
void sm_restore_login();

}} // namespace Slic3r::GUI

#endif // slic3r_GUI_SMAccountPersist_hpp_
