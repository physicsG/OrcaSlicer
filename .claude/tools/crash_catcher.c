/* LD_PRELOAD crash catcher.
 *
 * There is no gdb in this environment, so this traps fatal signals and writes a
 * module-relative backtrace that `start.sh trace` resolves with addr2line. It also
 * dumps registers and any readable strings from the top frames, which is often enough
 * to name the object involved.
 *
 *   ./.claude/tools/start.sh run      launch Orca with this armed
 *   ./.claude/tools/start.sh trace    resolve the captured backtrace
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <execinfo.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ucontext.h>
#include <unistd.h>

static char g_log[1024] = "/tmp/orca_crash.log";
static char g_altstack[256 * 1024];   /* SIGSTKSZ is not a constant on modern glibc */
static int  g_mem_fd = -1;

static void wr(int fd, const char *s) { ssize_t r = write(fd, s, strlen(s)); (void) r; }

/* pread on /proc/self/mem fails instead of faulting, so the handler cannot crash. */
static int safe_read(unsigned long addr, void *out, size_t len)
{
    return g_mem_fd >= 0 && addr >= 0x1000 && pread(g_mem_fd, out, len, (off_t) addr) == (ssize_t) len;
}

static int safe_str(unsigned long addr, char *out, size_t cap)
{
    char buf[128];
    if (!safe_read(addr, buf, sizeof(buf)))
        return 0;
    size_t i = 0;
    for (; i < sizeof(buf) - 1 && i < cap - 1; ++i) {
        unsigned char c = (unsigned char) buf[i];
        if (c == 0) break;
        if (c < 0x20 || c > 0x7e) return 0;
        out[i] = (char) c;
    }
    out[i] = 0;
    return i >= 3;
}

static void handler(int sig, siginfo_t *info, void *ctx)
{
    int fd = open(g_log, O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd < 0) fd = STDERR_FILENO;

    char line[512];
    snprintf(line, sizeof(line), "\n=== FATAL signal %d (code %d) at %p, pid %d ===\n",
             sig, info ? info->si_code : 0, info ? info->si_addr : NULL, (int) getpid());
    wr(fd, line);

    void *frames[128];
    int   n = backtrace(frames, 128);
    for (int i = 0; i < n; ++i) {
        Dl_info di;
        memset(&di, 0, sizeof(di));
        if (dladdr(frames[i], &di) && di.dli_fname) {
            unsigned long off = (unsigned long) ((char *) frames[i] - (char *) di.dli_fbase);
            snprintf(line, sizeof(line), "#%-2d %s+0x%lx  %s\n", i, di.dli_fname, off,
                     di.dli_sname ? di.dli_sname : "?");
        } else {
            snprintf(line, sizeof(line), "#%-2d %p <unknown>\n", i, frames[i]);
        }
        wr(fd, line);
    }

    {
        ucontext_t *uc = (ucontext_t *) ctx;
        static const struct { const char *n; int i; } regs[] = {
            {"RDI", REG_RDI}, {"RSI", REG_RSI}, {"RBX", REG_RBX}, {"RAX", REG_RAX},
            {"R12", REG_R12}, {"R13", REG_R13}, {"RBP", REG_RBP}, {"RSP", REG_RSP},
        };
        char str[128];
        wr(fd, "--- registers (strings resolved where readable) ---\n");
        for (unsigned i = 0; i < sizeof(regs) / sizeof(regs[0]); ++i) {
            unsigned long v = (unsigned long) uc->uc_mcontext.gregs[regs[i].i];
            snprintf(line, sizeof(line), "%s=0x%-14lx%s", regs[i].n, v, (i % 4 == 3) ? "\n" : " ");
            wr(fd, line);
            if (safe_str(v, str, sizeof(str))) {
                snprintf(line, sizeof(line), "\n    %s -> \"%s\"\n", regs[i].n, str);
                wr(fd, line);
            }
        }
        unsigned long rbp = (unsigned long) uc->uc_mcontext.gregs[REG_RBP];
        for (int depth = 0; depth < 3 && rbp; ++depth) {
            snprintf(line, sizeof(line), "\n--- frame %d locals ---\n", depth);
            wr(fd, line);
            for (long off = -0x80; off <= 0x10; off += 8) {
                unsigned long slot = 0;
                if (safe_read(rbp + off, &slot, sizeof(slot)) && safe_str(slot, str, sizeof(str))) {
                    snprintf(line, sizeof(line), "  [rbp%+ld] -> \"%s\"\n", off, str);
                    wr(fd, line);
                }
            }
            unsigned long next = 0;
            if (!safe_read(rbp, &next, sizeof(next)) || next <= rbp) break;
            rbp = next;
        }
    }
    wr(fd, "=== end ===\n");
    if (fd != STDERR_FILENO) close(fd);

    signal(sig, SIG_DFL);
    raise(sig);
}

/* An exception that escapes a wx event handler kills the app during teardown, so the
 * SIGABRT backtrace shows only destructors. Interposing __cxa_throw records where the
 * throw actually came from. Opt-in (THROW_LOG=1) because normal runs throw routinely. */
void __cxa_throw(void *thrown, void *tinfo, void (*dest)(void *))
{
    static void (*real)(void *, void *, void (*)(void *));
    if (!real)
        real = (void (*)(void *, void *, void (*)(void *))) dlsym(RTLD_NEXT, "__cxa_throw");

    if (getenv("THROW_LOG")) {
        int fd = open(g_log, O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (fd >= 0) {
            char line[512];
            /* Itanium ABI: std::type_info is { vptr, const char *__name }. */
            const char *name = tinfo ? *(const char **) ((char *) tinfo + sizeof(void *)) : "?";
            snprintf(line, sizeof(line), "\n=== THROW %s ===\n", name ? name : "?");
            wr(fd, line);

            void *frames[32];
            int   n = backtrace(frames, 32);
            for (int i = 1; i < n && i < 14; ++i) {
                Dl_info di;
                memset(&di, 0, sizeof(di));
                if (dladdr(frames[i], &di) && di.dli_fname) {
                    snprintf(line, sizeof(line), "#%-2d %s+0x%lx  %s\n", i, di.dli_fname,
                             (unsigned long) ((char *) frames[i] - (char *) di.dli_fbase),
                             di.dli_sname ? di.dli_sname : "?");
                } else {
                    snprintf(line, sizeof(line), "#%-2d %p\n", i, frames[i]);
                }
                wr(fd, line);
            }
            close(fd);
        }
    }

    real(thrown, tinfo, dest);
    __builtin_unreachable();
}

__attribute__((constructor)) static void install(void)
{
    const char *p = getenv("CRASH_LOG");
    if (p && *p) { strncpy(g_log, p, sizeof(g_log) - 1); g_log[sizeof(g_log) - 1] = 0; }
    g_mem_fd = open("/proc/self/mem", O_RDONLY);

    stack_t ss = { .ss_sp = g_altstack, .ss_size = sizeof(g_altstack), .ss_flags = 0 };
    sigaltstack(&ss, NULL);

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_sigaction = handler;
    sa.sa_flags     = SA_SIGINFO | SA_ONSTACK;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGSEGV, &sa, NULL);
    sigaction(SIGBUS,  &sa, NULL);
    sigaction(SIGFPE,  &sa, NULL);
    sigaction(SIGILL,  &sa, NULL);
    sigaction(SIGABRT, &sa, NULL);

    int fd = open(g_log, O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd >= 0) { wr(fd, "[crash_catcher] armed\n"); close(fd); }
}
