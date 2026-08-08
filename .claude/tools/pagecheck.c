// Headless check for the ace-mmu HTML pages: loads a local page in WebKitGTK, runs
// its JS, and reports console errors plus the result of a probe expression. Catches
// the class of bug a compiler never will (a stray ReferenceError leaves the page
// blank in the app, with no error anywhere in the C++ logs).
//
//   gcc -O0 -g -o pagecheck pagecheck.c $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1)
//   GDK_BACKEND=x11 ./pagecheck ../load-plan-mockup.html
//   GDK_BACKEND=x11 ./pagecheck ../../../resources/web/aceplan/index.html "document.querySelectorAll('.pos').length"
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

static const char *g_probe = "document.querySelectorAll('.pos').length";
static int         g_done = 0;

static void on_eval(GObject *src, GAsyncResult *res, gpointer user)
{
    GError   *err = NULL;
    JSCValue *v   = webkit_web_view_evaluate_javascript_finish(WEBKIT_WEB_VIEW(src), res, &err);
    if (err) {
        g_print("EVAL ERROR: %s\n", err->message);
        g_error_free(err);
    } else if (v) {
        char *s = jsc_value_to_string(v);
        g_print("%s = %s\n", (const char *) user, s);
        g_free(s);
    }
    if (++g_done >= 2)
        gtk_main_quit();
}

static gboolean probe(gpointer view)
{
    webkit_web_view_evaluate_javascript(WEBKIT_WEB_VIEW(view), "window.__err || 'none'", -1, NULL, NULL, NULL,
                                        on_eval, (gpointer) "js_error");
    webkit_web_view_evaluate_javascript(WEBKIT_WEB_VIEW(view), g_probe, -1, NULL, NULL, NULL,
                                        on_eval, (gpointer) "probe");
    return G_SOURCE_REMOVE;
}

static void on_load(WebKitWebView *view, WebKitLoadEvent ev, gpointer u)
{
    if (ev == WEBKIT_LOAD_FINISHED)
        g_timeout_add(700, probe, view);   // let render()/rAF settle
}

int main(int argc, char **argv)
{
    gtk_init(&argc, &argv);
    if (argc < 2) {
        g_print("usage: pagecheck <file.html> [js-probe-expression]\n");
        return 2;
    }
    if (argc > 2)
        g_probe = argv[2];

    WebKitUserContentManager *ucm = webkit_user_content_manager_new();
    // Trap the first JS error whenever it happens, so a probe can report it.
    webkit_user_content_manager_add_script(ucm, webkit_user_script_new(
        "window.__err = null; window.addEventListener('error', function(e){"
        " if(!window.__err) window.__err = e.message + ' @' + e.lineno; });",
        WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, NULL, NULL));

    GtkWidget *win  = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    GtkWidget *view = webkit_web_view_new_with_user_content_manager(ucm);
    gtk_container_add(GTK_CONTAINER(win), view);
    gtk_window_set_default_size(GTK_WINDOW(win), 1000, 800);

    // Console messages (including uncaught errors) go to stdout.
    webkit_settings_set_enable_write_console_messages_to_stdout(
        webkit_web_view_get_settings(WEBKIT_WEB_VIEW(view)), TRUE);

    g_signal_connect(view, "load-changed", G_CALLBACK(on_load), NULL);
    char *uri = g_strdup_printf("file://%s", argv[1]);
    webkit_web_view_load_uri(WEBKIT_WEB_VIEW(view), uri);
    gtk_widget_show_all(win);
    gtk_main();
    g_free(uri);
    return 0;
}
