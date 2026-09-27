# Python

Apply together with the core checklist in SKILL.md.

## Correctness
- Mutable default argument (`def f(x=[])`, `={}`): state shared across calls.
- Broad `except:` / `except Exception:` swallowing errors; `except ... pass`. Catch the specific exception.
- `is` to compare values (`is 0`, `is "x"`); use `==`. `is` only for `None`/singletons.
- Iterating and mutating the same list/dict.
- Integer vs float division; `round` uses banker's rounding for money → `Decimal`.
- `datetime.now()` without a time zone; mixing naive and aware datetimes.
- Closures in a loop capturing the loop variable (late binding).

## Resources
- `open`, connections, locks without `with`.
- Generators/large files loaded whole with `.read()`/`list()` for no reason.

## Security
- `subprocess` with `shell=True` and external input; `os.system`.
- `pickle`, `yaml.load` (without `SafeLoader`), `eval`/`exec` on external data.
- SQL built with f-strings/`%`/`.format` → driver/ORM parameters.
- `requests` without `timeout`; `verify=False`.
- `tempfile.mktemp`; overly open file permissions.
- Django/Flask: `DEBUG=True`, `csrf_exempt` without a reason, `mark_safe`/`|safe` on user data, `raw()`/`extra()` with interpolation.

## Async
- Blocking call (`requests`, `time.sleep`, sync I/O) inside `async def`.
- Coroutine created and never awaited; `asyncio.create_task` without keeping a reference.

## Style that matters
- Type hints on new public functions when the project already uses them; `Optional` handled.
- Forgotten debug `print`; `logging` with f-strings on a hot path (use lazy args).
- New circular import; `from x import *`.

## Tests
- pytest: fixture with the wrong scope leaking state; `mock.patch` on the wrong path (patch where it is used, not where it is defined).
- Tests that depend on order, the real network, or the real clock (use `freezegun`/injection).
