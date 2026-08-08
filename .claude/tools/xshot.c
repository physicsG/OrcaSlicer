/* Screenshot an X display to a PNG.
 *
 * Exists so GUI crashes can be reproduced here instead of being bounced off the user:
 * Xvfb gives a display, xdotool drives it, and this is the only way to see the result.
 * Writes PNG directly (zlib does the compression) to avoid pulling in imagemagick.
 *
 *   xshot <out.png> [display]      whole screen, default display :99
 */
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

static void be32(unsigned char *p, unsigned long v)
{
    p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v;
}

/* One PNG chunk: length, type, payload, CRC over type+payload. */
static void chunk(FILE *f, const char *type, const unsigned char *data, unsigned long len)
{
    unsigned char hdr[4];
    be32(hdr, len);
    fwrite(hdr, 1, 4, f);
    fwrite(type, 1, 4, f);
    if (len) fwrite(data, 1, len, f);
    uLong c = crc32(crc32(0L, (const Bytef *) type, 4), (const Bytef *) data, len);
    be32(hdr, c);
    fwrite(hdr, 1, 4, f);
}

int main(int argc, char **argv)
{
    const char *out = argc > 1 ? argv[1] : "screen.png";
    const char *dpy_name = argc > 2 ? argv[2] : ":99";

    Display *dpy = XOpenDisplay(dpy_name);
    if (!dpy) { fprintf(stderr, "xshot: cannot open display %s\n", dpy_name); return 1; }

    Window root = DefaultRootWindow(dpy);
    XWindowAttributes wa;
    XGetWindowAttributes(dpy, root, &wa);
    const int w = wa.width, h = wa.height;

    XImage *img = XGetImage(dpy, root, 0, 0, w, h, AllPlanes, ZPixmap);
    if (!img) { fprintf(stderr, "xshot: XGetImage failed\n"); return 1; }

    /* Raw scanlines, each prefixed with filter byte 0. */
    unsigned long raw_len = (unsigned long) h * (1 + 3 * (unsigned long) w);
    unsigned char *raw = malloc(raw_len);
    if (!raw) { fprintf(stderr, "xshot: out of memory\n"); return 1; }

    unsigned char *p = raw;
    for (int y = 0; y < h; ++y) {
        *p++ = 0;
        for (int x = 0; x < w; ++x) {
            unsigned long px = XGetPixel(img, x, y);
            *p++ = (px & img->red_mask)   >> 16;
            *p++ = (px & img->green_mask) >> 8;
            *p++ = (px & img->blue_mask);
        }
    }

    uLongf comp_len = compressBound(raw_len);
    unsigned char *comp = malloc(comp_len);
    if (!comp || compress2(comp, &comp_len, raw, raw_len, 6) != Z_OK) {
        fprintf(stderr, "xshot: compression failed\n");
        return 1;
    }

    FILE *f = fopen(out, "wb");
    if (!f) { fprintf(stderr, "xshot: cannot write %s\n", out); return 1; }
    fwrite("\x89PNG\r\n\x1a\n", 1, 8, f);

    unsigned char ihdr[13];
    be32(ihdr, w);
    be32(ihdr + 4, h);
    ihdr[8] = 8;      /* bit depth */
    ihdr[9] = 2;      /* truecolour RGB */
    ihdr[10] = ihdr[11] = ihdr[12] = 0;
    chunk(f, "IHDR", ihdr, sizeof(ihdr));
    chunk(f, "IDAT", comp, comp_len);
    chunk(f, "IEND", NULL, 0);
    fclose(f);

    printf("%s (%dx%d)\n", out, w, h);
    return 0;
}
