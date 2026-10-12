"""Drive one browser-choice prompt through a real terminal for the CLI smoke."""

import errno
import os
import pty
import select
import signal
import sys
import time

child_pid, terminal = pty.fork()
if child_pid == 0:
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)

deadline = time.monotonic() + 15
output = b""
answered = False
try:
    while time.monotonic() < deadline:
        if select.select([terminal], [], [], 0.1)[0]:
            try:
                chunk = os.read(terminal, 8192)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not chunk:
                break
            output += chunk
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
            if not answered and b"Open approval page now?" in output:
                reply = os.environ.get("RECALLANT_SMOKE_PTY_RESPONSE", "yes")
                os.write(terminal, (reply + "\n").encode())
                answered = True
    else:
        os.kill(child_pid, signal.SIGKILL)
        raise RuntimeError("CLI terminal did not finish within the fixture deadline")
    _, status = os.waitpid(child_pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))
finally:
    os.close(terminal)
