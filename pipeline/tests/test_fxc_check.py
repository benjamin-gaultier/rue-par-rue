"""The pure parts of tools/fxc/check.py (the compile itself needs Windows and a browser)."""
import importlib.util
from pathlib import Path

_path = Path(__file__).resolve().parents[2] / "tools" / "fxc" / "check.py"
_spec = importlib.util.spec_from_file_location("fxc_check", _path)
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)


def test_parse_ok():
    r = check.parse_result(0, "OK 1.25 2473 slots, 19 temps\n")
    assert r == {"status": "ok", "seconds": 1.25, "slots": 2473, "temps": 19, "error": ""}


def test_parse_ok_without_disassembly():
    r = check.parse_result(0, "OK 0.40 ? slots, ? temps")
    assert (r["status"], r["seconds"], r["slots"], r["temps"]) == ("ok", 0.4, None, None)


def test_parse_fail_keeps_the_error():
    r = check.parse_result(2, "FAIL 0.10 shader(12,3): error X3004: undeclared identifier 'foo'")
    assert r["status"] == "fail" and r["seconds"] == 0.1 and "X3004" in r["error"]


def test_parse_stack_overflow_signed_or_unsigned():
    assert check.parse_result(0xC00000FD, "")["status"] == "overflow"
    assert check.parse_result(0xC00000FD - (1 << 32), "")["status"] == "overflow"


def test_parse_unknown_exit_is_a_crash():
    r = check.parse_result(3, "")
    assert r["status"] == "crash" and "3" in r["error"]


def test_verdict():
    ok = check.parse_result(0, "OK 3.06 4679 slots, 19 temps")
    assert check.verdict(ok, 5) == "ok"
    assert check.verdict(ok, 3).startswith("SLOW")
    assert check.verdict(check.parse_result(0xC00000FD, ""), 5) == "STACK OVERFLOW"
    assert check.verdict(check.parse_result(2, "FAIL 0.10 error X3004"), 5).startswith("FAIL")
    assert not check.passes(check.parse_result(3, ""), 5)


def test_reference_shader_is_not_held_to_the_limit():
    slow = check.parse_result(0, "OK 9.00 6236 slots, 19 temps")
    assert check.verdict(slow, 5, "walls-all") == "not drawn"
    assert check.passes(slow, 5, "walls-all")
    assert not check.passes(slow, 5, "walls")


def test_harness_problems():
    report = "walls: glsl 100 hlsl 200\nroofs: glsl 5 hlsl 9 COMPILE ERROR ERROR: 0:1\ncrown: no program"
    assert check.harness_problems(report) == ["roofs: glsl 5 hlsl 9 COMPILE ERROR ERROR: 0:1", "crown: no program"]


def test_table_text_and_markdown():
    rows = [("walls", 22000, check.parse_result(0, "OK 0.42 1231 slots, 19 temps")),
            ("roofs", 18000, check.parse_result(0xC00000FD, ""))]
    text = check.table(rows, 5).splitlines()
    assert text[0].split() == ["Shader", "HLSL", "kB", "Compile", "s", "Slots", "Temps", "Result"]
    assert text[1].split() == ["walls", "22", "0.42", "1231", "19", "ok"]
    assert text[2].endswith("STACK OVERFLOW")
    md = check.table(rows, 5, markdown=True).splitlines()
    assert md[2] == "| walls | 22 | 0.42 | 1231 | 19 | ok |"
