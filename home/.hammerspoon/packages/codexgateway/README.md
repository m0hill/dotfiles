# Codex Gateway

Controls the `com.m0hill.codex-gateway` user LaunchAgent from the Hammerspoon menubar.

The module checks `http://127.0.0.1:43129/health` and provides start, restart, stop, log, and health actions. Disabling the Hammerspoon module stops monitoring only; it does not stop the gateway.
