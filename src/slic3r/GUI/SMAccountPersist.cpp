#include "SMAccountPersist.hpp"
#include "GUI_App.hpp"
#include "libslic3r/AppConfig.hpp"

#include <boost/log/trivial.hpp>

namespace Slic3r { namespace GUI {

static const char* SM_SECTION = "sm_account";

void sm_persist_login()
{
    auto*      ui  = wxGetApp().sm_get_userinfo();
    AppConfig* cfg = wxGetApp().app_config;
    if (!ui || !cfg)
        return;

    cfg->set(SM_SECTION, "token", ui->get_user_token());
    cfg->set(SM_SECTION, "id", ui->get_user_id());
    cfg->set(SM_SECTION, "account", ui->get_user_account());
    cfg->set(SM_SECTION, "name", ui->get_user_name());
    cfg->set(SM_SECTION, "icon", ui->get_user_icon_url());
    cfg->set(SM_SECTION, "login", ui->is_user_login() ? std::string("1") : std::string("0"));
    cfg->save();
    BOOST_LOG_TRIVIAL(info) << "sm_persist_login: saved account (login=" << ui->is_user_login() << ", has_token=" << !ui->get_user_token().empty() << ")";
}

void sm_announce_login()
{
    auto* ui = wxGetApp().sm_get_userinfo();
    if (!ui || !ui->is_user_login())
        return;
    ui->notify();
    BOOST_LOG_TRIVIAL(info) << "sm_announce_login: re-announced " << ui->get_user_account();
}

void sm_restore_login()
{
    auto*      ui  = wxGetApp().sm_get_userinfo();
    AppConfig* cfg = wxGetApp().app_config;
    if (!ui || !cfg)
        return;

    const std::string token = cfg->get(SM_SECTION, "token");
    if (token.empty()) {
        BOOST_LOG_TRIVIAL(info) << "sm_restore_login: no saved token";
        return;
    }

    ui->set_user_id(cfg->get(SM_SECTION, "id"));
    ui->set_user_account(cfg->get(SM_SECTION, "account"));
    ui->set_user_name(cfg->get(SM_SECTION, "name"));
    ui->set_user_icon_url(cfg->get(SM_SECTION, "icon"));
    ui->set_user_token(token);
    ui->set_user_login(true); // also notify()s any login-state subscribers
    BOOST_LOG_TRIVIAL(info) << "sm_restore_login: restored account " << ui->get_user_account();
}

}} // namespace Slic3r::GUI
