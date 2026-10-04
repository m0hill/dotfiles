-- Full clipboard preview without extending the private hs.ui toolkit.
return function(onReturn, onPaste)
	local P = {}
	local webview, controller, backdrop = nil, nil, nil
	local visible = false

	local function escape(value)
		return tostring(value or "")
			:gsub("&", "&amp;")
			:gsub("<", "&lt;")
			:gsub(">", "&gt;")
			:gsub('"', "&quot;")
			:gsub("'", "&#39;")
	end

	function P.isVisible()
		return visible
	end

	function P.hide()
		visible = false
		if webview then
			webview:hide()
		end
		if backdrop then
			backdrop:hide()
		end
	end

	function P.show(item, frame, context, imagePath)
		P.delete()
		local content
		if item.type == "image" then
			local image = imagePath and hs.image.imageFromPath(imagePath)
			if not image then
				return false
			end
			content = '<img alt="Clipboard image" src="' .. escape(image:encodeAsURLString(true, "PNG")) .. '">'
		else
			content = '<pre tabindex="0">' .. escape(item.text) .. "</pre>"
		end
		controller = hs.webview.usercontent.new("launcherPreview")
		controller:setCallback(function(message)
			if not visible then
				return
			end
			if message.body == "back" then
				P.hide()
				onReturn()
			elseif message.body == "paste" then
				P.hide()
				onPaste(item)
			end
		end)
		-- Use the exact native HUD material, radius, and shadow of the launcher.
		-- CSS stays transparent; WebKit cannot reproduce AppKit's behind-window vibrancy.
		local ui = require("hs.ui")
		backdrop = ui.panel.new({
			frame = frame,
			style = "borderless",
			level = "floating",
			material = "hud",
			cornerRadius = 18,
			shadow = true,
			closeOnBlur = false,
			escapeCloses = false,
		})
		backdrop:setContent(ui.stack.new({ views = {} }))
		webview = hs.webview
			.new(frame, { developerExtrasEnabled = false }, controller)
			:windowStyle("borderless")
			:transparent(true)
			:shadow(false)
			:level(hs.drawing.windowLevels.floating)
			:allowTextEntry(true)
		webview:windowCallback(function(action, _, focused)
			if action == "focusChange" and not focused then
				P.hide()
			end
		end)
		webview:html([=[<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
:root { color-scheme: light dark; --fg: rgba(0,0,0,.85); --muted: rgba(0,0,0,.5); --control: rgba(0,0,0,.08); --hover: rgba(0,0,0,.13); }
@media (prefers-color-scheme: dark) { :root { --fg: rgba(255,255,255,.85); --muted: rgba(255,255,255,.55); --control: rgba(255,255,255,.12); --hover: rgba(255,255,255,.18); } }
* { box-sizing: border-box; }
html,body { margin: 0; height: 100%; background: transparent; font: 14px -apple-system, BlinkMacSystemFont, sans-serif; color: var(--fg); }
body { border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; }
header { padding: 16px 14px 12px; }
h1 { margin: 0 0 8px; font-size: 17px; line-height: 30px; font-weight: 400; color: var(--muted); }
.context { font-size: 12px; line-height: 17px; color: var(--muted); overflow-wrap: anywhere; }
main { padding: 8px 24px 16px; overflow: auto; flex: 1; min-height: 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font: inherit; line-height: 1.6; tab-size: 4; }
img { display: block; max-width: 100%; height: auto; margin: auto; border-radius: 8px; }
footer { padding: 10px 14px 12px; display: flex; align-items: center; gap: 8px; }
.hint { flex: 1; color: var(--muted); font-size: 12px; }
button { color: var(--fg); background: var(--control); border: 0; border-radius: 8px; padding: 7px 12px; font: 500 12px -apple-system, sans-serif; cursor: pointer; }
button:hover { background: var(--hover); }
button:focus-visible,pre:focus-visible { outline: 2px solid Highlight; outline-offset: 3px; }
</style></head><body><header><h1>Clipboard preview</h1><div class="context">]=] .. escape(context) .. "</div></header><main>" .. content .. [=[</main><footer>
<span class="hint">Esc / Tab · Back &nbsp; Enter · Paste</span>
<button onclick="send('back')">Back</button><button onclick="send('paste')">Paste</button>
</footer><script>
function send(action) { window.webkit.messageHandlers.launcherPreview.postMessage(action); }
document.addEventListener('keydown', function(e) {
 if (e.key === 'Escape' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); send('back'); }
 else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.target.tagName !== 'BUTTON') { e.preventDefault(); send('paste'); }
});
</script></body></html>]=])
		visible = true
		backdrop:show()
		webview:show():bringToFront()
		return true
	end

	function P.delete()
		visible = false
		if webview then
			webview:windowCallback(nil)
			webview:delete()
			webview = nil
		end
		if controller then
			controller:setCallback(nil)
			controller = nil
		end
		if backdrop then
			backdrop:delete()
			backdrop = nil
		end
	end

	return P
end
