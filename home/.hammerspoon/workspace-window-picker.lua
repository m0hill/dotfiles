local aerospace = "/opt/homebrew/bin/aerospace"

local picker = hs.chooser.new(function(choice)
    if choice then
        hs.task.new(aerospace, function() end, {"focus", "--window-id", choice.windowID}):start()
    end
end)
picker:placeholderText("Find a window in this workspace")
picker:searchSubText(true)

local function showWindows()
    local workspace, ok = hs.execute(aerospace .. " list-workspaces --focused")
    if not ok then return end
    workspace = workspace:gsub("%s+$", "")
    local output, listed = hs.execute(aerospace .. " list-windows --workspace " ..
        "'" .. workspace:gsub("'", "'\\''") .. "'" ..
        " --format '%{window-id}|%{app-name}|%{window-title}'")
    if not listed then return end
    local rows = {}
    for line in output:gmatch("[^\n]+") do
        local id, app, title = line:match("^(%d+)|([^|]*)|(.*)$")
        if id then
            table.insert(rows, {text = title ~= "" and title or app, subText = app, windowID = id})
        end
    end
    if #rows == 0 then hs.alert.show("No windows in " .. workspace); return end
    picker:query("")
    picker:choices(rows)
    picker:placeholderText(string.format("%s · %d windows", workspace, #rows))
    picker:show()
end

hs.hotkey.bind({"alt"}, "`", showWindows)

-- App activation alone may leave GitHub Desktop's native sheet offscreen.
-- Only intervene when AeroSpace stayed on an empty workspace.
local github = "com.github.GitHubClient"
local function restoreGitHubWorkspace()
    local front = hs.application.frontmostApplication()
    if not front or front:bundleID() ~= github then return end
    local focused, ok = hs.execute(aerospace .. " list-workspaces --focused")
    if not ok or not focused:match("^[%w%-]+%s*$") then return end
    local current = focused:match("^([%w%-]+)")
    if current == "6-GitHub" then return end
    local present, checked = hs.execute(aerospace .. " list-windows --workspace " .. current .. " --format '%{window-id}'")
    if not checked or present:match("%S") then return end
    local windows, listed = hs.execute(aerospace ..
        " list-windows --workspace 6-GitHub --app-bundle-id " .. github .. " --format '%{window-id}'")
    if listed and windows:match("%S") then
        hs.task.new(aerospace, function() end, {"workspace", "6-GitHub"}):start()
    end
end

_G.aerospaceGitHubActivation = hs.application.watcher.new(function(_, event, app)
    if event == hs.application.watcher.activated and app and app:bundleID() == github then
        hs.timer.doAfter(0.2, restoreGitHubWorkspace)
    end
end):start()
