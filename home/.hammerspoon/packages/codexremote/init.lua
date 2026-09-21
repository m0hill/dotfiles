--- Codex Remote
--- Send messages from a Tailscale-only web page to the open Codex thread.
---
--- @package codexremote

return function(manager)
	local P = {}
	local PACKAGE_ID = "codexremote"
	local PACKAGE_NAME = "Codex Remote"
	local CODEX_BUNDLE_ID = "com.openai.codex"
	local DEFAULT_PORT = 8765
	local MAX_MESSAGE_BYTES = 20000
	local MAX_IMAGE_BYTES = 25 * 1024 * 1024
	local MAX_REQUEST_BYTES = 36 * 1024 * 1024
	local UPLOAD_DIR = "/tmp/codex-remote"
	local RECONCILE_SECONDS = 10
	local TAILSCALE_BINARIES = {
		"/Applications/Tailscale.app/Contents/MacOS/tailscale",
		"/opt/homebrew/bin/tailscale",
		"/usr/local/bin/tailscale",
	}

	local server = nil
	local reconcile_timer = nil
	local bound_address = nil
	local sending = false
	local status = "stopped"
	local status_detail = ""
	local upload_sequence = 0

	local PAGE = [=[<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="theme-color" content="#f3f0e8">
	<title>Codex Remote</title>
	<style>
		:root { color-scheme: light; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
		* { box-sizing: border-box; }
		body { margin: 0; min-height: 100dvh; background: #f3f0e8; color: #1d1d1b; }
		main { width: min(100%, 42rem); min-height: 100dvh; margin: 0 auto; padding: max(1.25rem, env(safe-area-inset-top)) 1rem max(1.25rem, env(safe-area-inset-bottom)); display: flex; flex-direction: column; justify-content: center; gap: 1.25rem; }
		h1 { margin: 0; font-size: clamp(2rem, 9vw, 4rem); line-height: .95; letter-spacing: -.035em; }
		p { margin: 0; color: #656159; font-size: .95rem; }
		form { display: grid; gap: .75rem; }
		textarea { width: 100%; min-height: 13rem; resize: vertical; padding: 1rem; border: 1px solid #b9b3a7; border-radius: 14px; background: #fffefa; color: #1d1d1b; font: inherit; font-size: 1.08rem; line-height: 1.5; caret-color: #155eef; }
		input[type="file"] { width: 100%; padding: .8rem; border: 1px solid #b9b3a7; border-radius: 14px; background: #fffefa; font: inherit; }
		textarea:focus-visible, input:focus-visible, button:focus-visible { outline: 3px solid #8fb4ff; outline-offset: 3px; }
		button { min-height: 3.4rem; border: 0; border-radius: 14px; background: #155eef; color: white; font: inherit; font-size: 1.05rem; font-weight: 700; cursor: pointer; }
		button:disabled { cursor: wait; background: #8b919c; }
		#status { min-height: 1.5rem; color: #4d4942; }
		#status[data-kind="error"] { color: #a1261d; }
		#status[data-kind="success"] { color: #176b3a; }
		::selection { background: #b8cffd; color: #101a2d; }
	</style>
</head>
<body>
	<main>
		<div>
			<h1>Codex Remote</h1>
			<p>Send to the thread currently open on your Mac.</p>
		</div>
		<form id="form">
			<label for="message">Message</label>
			<textarea id="message" name="message" maxlength="20000" placeholder="What should Codex do?" autocomplete="off" autofocus></textarea>
			<label for="photos">Photos <span aria-hidden="true">(optional)</span></label>
			<input id="photos" name="photos" type="file" accept="image/*" multiple>
			<p id="file-summary">No photos selected</p>
			<button id="send" type="submit">Send to Codex</button>
		</form>
		<p id="status" role="status" aria-live="polite">Ready</p>
	</main>
	<script>
		const form = document.querySelector("#form");
		const message = document.querySelector("#message");
		const photos = document.querySelector("#photos");
		const fileSummary = document.querySelector("#file-summary");
		const button = document.querySelector("#send");
		const status = document.querySelector("#status");

		photos.addEventListener("change", () => {
			const count = photos.files.length;
			fileSummary.textContent = count === 0 ? "No photos selected" : `${count} photo${count === 1 ? "" : "s"} selected`;
		});

		function readAsDataUrl(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result);
				reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
				reader.readAsDataURL(file);
			});
		}

		async function uploadPhoto(file, index, total) {
			status.textContent = `Uploading photo ${index + 1} of ${total}…`;
			const dataUrl = await readAsDataUrl(file);
			const comma = dataUrl.indexOf(",");
			const response = await fetch("/upload", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: file.name,
					type: file.type,
					data: dataUrl.slice(comma + 1),
				}),
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || `Could not upload ${file.name}.`);
			return result.path;
		}

		form.addEventListener("submit", async (event) => {
			event.preventDefault();
			const text = message.value.trim();
			const files = Array.from(photos.files);
			if (!text && files.length === 0) {
				status.dataset.kind = "error";
				status.textContent = "Type a message or choose at least one photo.";
				return;
			}

			button.disabled = true;
			button.textContent = "Sending…";
			status.dataset.kind = "";

			try {
				const paths = [];
				for (let index = 0; index < files.length; index += 1) {
					paths.push(await uploadPhoto(files[index], index, files.length));
				}
				const imageNote = paths.length === 0 ? "" : [
					"The following image files were uploaded from my phone. Inspect them as part of this request:",
					...paths.map((path) => `- ${path}`),
				].join("\\n");
				const outgoing = [text, imageNote].filter(Boolean).join("\\n\\n");

				status.textContent = "Focusing Codex on your Mac…";
				const response = await fetch("/send", {
					method: "POST",
					headers: { "Content-Type": "text/plain; charset=utf-8" },
					body: outgoing,
				});
				const result = await response.json();
				if (!response.ok) throw new Error(result.error || "Could not send the message.");
				message.value = "";
				photos.value = "";
				fileSummary.textContent = "No photos selected";
				status.dataset.kind = "success";
				status.textContent = "Sent";
			} catch (error) {
				status.dataset.kind = "error";
				status.textContent = error.message;
			} finally {
				button.disabled = false;
				button.textContent = "Send to Codex";
				message.focus();
			}
		});
	</script>
</body>
</html>]=]

	local function response(body, code, contentType)
		return body, code, {
			["Cache-Control"] = "no-store",
			["Content-Type"] = contentType or "text/plain; charset=utf-8",
			["X-Content-Type-Options"] = "nosniff",
		}
	end

	local function jsonResponse(payload, code)
		return response(hs.json.encode(payload), code, "application/json; charset=utf-8")
	end

	local function trim(value)
		return tostring(value or ""):match("^%s*(.-)%s*$")
	end

	local function currentPort()
		local configured = tonumber(manager.getSetting(PACKAGE_ID, "port", DEFAULT_PORT))
		if not configured or configured < 1 or configured > 65535 then
			return DEFAULT_PORT
		end
		return math.floor(configured)
	end

	local function configuredAddress()
		local address = trim(manager.getSetting(PACKAGE_ID, "bindAddress", ""))
		return address ~= "" and address or nil
	end

	local function tailscaleAddress()
		local configured = configuredAddress()
		if configured then
			return configured
		end

		for _, binary in ipairs(TAILSCALE_BINARIES) do
			if hs.fs.attributes(binary, "mode") == "file" then
				local output, ok = hs.execute(string.format("%q ip -4", binary), true)
				if ok then
					local address = tostring(output or ""):match("(%d+%.%d+%.%d+%.%d+)")
					if address then
						return address
					end
				end
			end
		end
		return nil
	end

	local function setStatus(nextStatus, detail)
		status = nextStatus
		status_detail = detail or ""
	end

	local function stopServer()
		if server then
			server:stop()
			server = nil
		end
		bound_address = nil
	end

	local function visitDescendants(element, visitor, depth)
		if not element or depth > 48 then
			return nil
		end
		local result = visitor(element)
		if result then
			return result
		end
		local children = element:attributeValue("AXChildren")
		if type(children) == "table" then
			for _, child in ipairs(children) do
				result = visitDescendants(child, visitor, depth + 1)
				if result then
					return result
				end
			end
		end
		return nil
	end

	local function codexWindow()
		local app = hs.application.get(CODEX_BUNDLE_ID)
		if not app then
			return nil, nil, "Codex is not running on the Mac."
		end

		app:activate(true)
		hs.timer.usleep(200000)

		local appElement = hs.axuielement.applicationElement(app)
		if not appElement then
			return nil, nil, "Could not access Codex. Check Hammerspoon Accessibility permission."
		end
		appElement:setAttributeValue("AXEnhancedUserInterface", true)

		local window = appElement:attributeValue("AXFocusedWindow") or appElement:attributeValue("AXMainWindow")
		if not window then
			return nil, nil, "Codex has no open window."
		end
		return app, window, nil
	end

	local function findComposer(window)
		local fallback = nil
		local composer = visitDescendants(window, function(element)
			if element:attributeValue("AXRole") ~= "AXTextArea" or element:attributeValue("AXEnabled") == false then
				return nil
			end
			if not element:isAttributeSettable("AXValue") then
				return nil
			end

			fallback = fallback or element
			local name = (tostring(element:attributeValue("AXTitle") or "") .. " " .. tostring(element:attributeValue("AXDescription") or "")):lower()
			if name:find("do anything", 1, true) or name:find("ask codex", 1, true) or name:find("message", 1, true) then
				return element
			end
			return nil
		end, 0)
		return composer or fallback
	end

	local function composerIsEmpty(composer)
		local value = trim(composer:attributeValue("AXValue"))
		if value == "" then
			return true
		end
		local title = trim(composer:attributeValue("AXTitle"))
		local description = trim(composer:attributeValue("AXDescription"))
		return value == title or value == description
	end

	local function findSendButton(window)
		return visitDescendants(window, function(element)
			if element:attributeValue("AXRole") ~= "AXButton" or element:attributeValue("AXEnabled") == false then
				return nil
			end
			local title = trim(element:attributeValue("AXTitle")):lower()
			local description = trim(element:attributeValue("AXDescription")):lower()
			if title == "send" or description == "send" then
				return element
			end
			return nil
		end, 0)
	end

	local function focusComposer()
		local _, window, err = codexWindow()
		if err then
			return nil, err
		end
		local composer = findComposer(window)
		if not composer then
			return nil, "Open the Codex thread you want to control, then try again."
		end
		local focused, focusErr = composer:setAttributeValue("AXFocused", true)
		if not focused then
			return nil, "Found the Codex composer but could not focus it: " .. tostring(focusErr or "unknown error")
		end
		return composer, nil
	end

	local function sendToCodex(message)
		local composer, err = focusComposer()
		if err then
			return false, err
		end
		if not composerIsEmpty(composer) then
			return false, "Codex already has an unsent draft. Clear or send it on the Mac first."
		end

		local updated, updateErr = composer:setAttributeValue("AXValue", message)
		if not updated then
			return false, "Could not write to the Codex composer: " .. tostring(updateErr or "unknown error")
		end
		hs.timer.usleep(150000)

		local app = hs.application.get(CODEX_BUNDLE_ID)
		local appElement = app and hs.axuielement.applicationElement(app) or nil
		local window = appElement and (appElement:attributeValue("AXFocusedWindow") or appElement:attributeValue("AXMainWindow")) or nil
		local sendButton = window and findSendButton(window) or nil
		if not sendButton then
			composer:setAttributeValue("AXValue", "")
			return false, "The Send button is unavailable. Codex may still be working; try again when it finishes."
		end

		local pressed, pressErr = sendButton:performAction("AXPress")
		if not pressed then
			return false, "Found the Send button but could not press it: " .. tostring(pressErr or "unknown error")
		end
		return true, nil
	end

	local function safeFilename(name, mediaType)
		local filename = tostring(name or ""):gsub("\\", "/"):match("([^/]+)$") or ""
		filename = filename:gsub("[^%w%._%- ]", "_"):gsub("^%.+", ""):sub(1, 120)
		if filename == "" then
			local extensions = {
				["image/jpeg"] = ".jpg",
				["image/png"] = ".png",
				["image/heic"] = ".heic",
				["image/heif"] = ".heif",
				["image/webp"] = ".webp",
			}
			filename = "photo" .. (extensions[mediaType] or "")
		end
		return filename
	end

	local function saveUpload(body)
		local decoded, payload = pcall(hs.json.decode, body)
		if not decoded or type(payload) ~= "table" then
			return nil, "The photo upload was malformed."
		end

		local mediaType = trim(payload.type)
		if mediaType ~= "" and not mediaType:lower():match("^image/") then
			return nil, "Only image files can be uploaded."
		end
		if type(payload.data) ~= "string" or payload.data == "" then
			return nil, "The uploaded photo was empty."
		end

		local estimatedBytes = math.floor(#payload.data * 3 / 4)
		if estimatedBytes > MAX_IMAGE_BYTES then
			return nil, "Each photo must be 25 MB or smaller."
		end

		local ok, contents = pcall(hs.base64.decode, payload.data)
		if not ok or type(contents) ~= "string" or contents == "" then
			return nil, "The uploaded photo could not be decoded."
		end
		if #contents > MAX_IMAGE_BYTES then
			return nil, "Each photo must be 25 MB or smaller."
		end

		if not hs.fs.attributes(UPLOAD_DIR, "mode") then
			local created, createErr = hs.fs.mkdir(UPLOAD_DIR)
			if not created then
				return nil, "Could not create the temporary upload directory: " .. tostring(createErr or "unknown error")
			end
		end

		upload_sequence = upload_sequence + 1
		local filename = safeFilename(payload.name, mediaType)
		local path = string.format("%s/%d-%d-%s", UPLOAD_DIR, os.time(), upload_sequence, filename)
		local file, openErr = io.open(path, "wb")
		if not file then
			return nil, "Could not save the uploaded photo: " .. tostring(openErr or "unknown error")
		end
		file:write(contents)
		file:close()
		return path, nil
	end

	local function handleRequest(method, path, _, body)
		if method == "GET" and (path == "/" or path == "/index.html") then
			return response(PAGE, 200, "text/html; charset=utf-8")
		end
		if method == "GET" and path == "/health" then
			return jsonResponse({ status = status, detail = status_detail, sending = sending }, status == "ready" and 200 or 503)
		end
		if method == "POST" and path == "/upload" then
			local uploadedPath, uploadErr = saveUpload(body)
			if not uploadedPath then
				manager.log(PACKAGE_ID, uploadErr)
				return jsonResponse({ error = uploadErr }, 400)
			end
			return jsonResponse({ path = uploadedPath }, 201)
		end
		if method == "POST" and path == "/send" then
			local message = trim(body)
			if message == "" then
				return jsonResponse({ error = "Type a message first." }, 400)
			end
			if #message > MAX_MESSAGE_BYTES then
				return jsonResponse({ error = "Message is too long." }, 413)
			end
			if sending then
				return jsonResponse({ error = "Another message is already being sent." }, 409)
			end

			sending = true
			local ok, sendErr = sendToCodex(message)
			sending = false
			if not ok then
				manager.log(PACKAGE_ID, sendErr)
				return jsonResponse({ error = sendErr }, 409)
			end
			return jsonResponse({ ok = true }, 200)
		end
		return jsonResponse({ error = "Not found." }, 404)
	end

	local function startServer(address)
		stopServer()
		local candidate = hs.httpserver.new(false, false)
		candidate:setInterface(address)
		candidate:setPort(currentPort())
		candidate:maxBodySize(MAX_REQUEST_BYTES)
		candidate:setCallback(handleRequest)

		local ok, startErr = pcall(function()
			candidate:start()
		end)
		if not ok then
			candidate:stop()
			setStatus("error", tostring(startErr))
			manager.log(PACKAGE_ID, "Could not start server: " .. tostring(startErr))
			return false
		end

		server = candidate
		bound_address = address
		setStatus("ready", string.format("http://%s:%d", bound_address, currentPort()))
		manager.log(PACKAGE_ID, "Listening at " .. status_detail)
		return true
	end

	local function reconcileServer()
		local address = tailscaleAddress()
		if not address then
			stopServer()
			setStatus("waiting", "Start Tailscale to make the remote page available.")
			return
		end
		if server and bound_address == address then
			return
		end
		startServer(address)
	end

	function P.start()
		P.stop()
		setStatus("starting", "Looking for Tailscale…")
		reconcileServer()
		reconcile_timer = hs.timer.doEvery(RECONCILE_SECONDS, reconcileServer)
	end

	function P.stop()
		if reconcile_timer then
			reconcile_timer:stop()
			reconcile_timer = nil
		end
		stopServer()
		sending = false
		setStatus("stopped", "")
	end

	function P.getStatus()
		return status
	end

	function P.getMenuItems()
		local url = bound_address and string.format("http://%s:%d", bound_address, currentPort()) or nil
		return {
			{ title = status_detail ~= "" and status_detail or "Not running", disabled = true },
			{ title = "Open Remote Page", disabled = not url, fn = function() hs.urlevent.openURL(url) end },
			{ title = "Copy Remote URL", disabled = not url, fn = function() hs.pasteboard.setContents(url) end },
			{ title = "Test Codex Composer Focus", fn = function()
				local _, err = focusComposer()
				if err then
					manager.notifyError(PACKAGE_NAME, err, { withdrawAfter = 5 })
				else
					manager.notify(PACKAGE_NAME, "Codex composer found and focused.", { withdrawAfter = 3 })
				end
			end },
			{ title = "Retry Tailscale", fn = reconcileServer },
		}
	end

	return P
end
