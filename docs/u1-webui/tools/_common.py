#!/usr/bin/env python3
"""Shared helpers for the U1 web-UI extractors.

Every tool in this directory reads the shipped Flutter bundle and/or the Orca
C++ sources and writes a machine-readable artefact into ../data/. Nothing here
mutates the repo outside that directory.
"""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BUNDLE = os.path.join(ROOT, "resources", "web", "flutter_web")
MAIN_JS = os.path.join(BUNDLE, "main.dart.js")
SSWCP_CPP = os.path.join(ROOT, "src", "slic3r", "GUI", "SSWCP.cpp")
DATA = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
RECON = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "reconstructed"))


def read_bundle():
    """The dart2js output as one string."""
    with open(MAIN_JS, encoding="utf-8", errors="replace") as f:
        return f.read()


def read_cpp(path=SSWCP_CPP):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def balanced(s, i, open_ch="(", close_ch=")"):
    """From the index of an opening bracket, return the index just past its match."""
    depth = 0
    while i < len(s):
        c = s[i]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i + 1
        elif c in "\"'":
            q, i = c, i + 1
            while i < len(s) and s[i] != q:
                i += 2 if s[i] == "\\" else 1
        i += 1
    return i
