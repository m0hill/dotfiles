--- Ports
--- Shows local TCP listeners and the process using each port.
---
--- @package ports
--- @version v1

return function(manager)
	local P = {}
	local PACKAGE_ID = "ports"
	local PACKAGE_NAME = "Ports"
	local LSOF_PATH = "/usr/sbin/lsof"
	local REFRESH_SECONDS = 5

	local refresh_timer = nil
	local refresh_task = nil
	local ports = {}
	local last_refresh = nil
	local last_error = nil
	local status = "stopped"

	local function cleanProcessName(value)
		return tostring(value or "unknown"):gsub("\\x20", " ")
	end

	local function settingShowAllInterfaces()
		return manager.getSetting(PACKAGE_ID, "showAllInterfaces", false) == true
	end

	local function extractPort(address)
		address = tostring(address or "")
		return address:match("%]:(%d+)$") or address:match(":(%d+)$")
	end

	local function hostForAddress(address)
		address = tostring(address or "")
		if
			address:sub(1, 1) == "*"
			or address:match("^127%.0%.0%.1:")
			or address:match("^localhost:")
			or address:match("^%[::%]:")
		then
			return "localhost"
		end
		if address:match("^%[::1%]:") then
			return "[::1]"
		end
		local bracketedIpv6 = address:match("^(%[[^%]]+%]):%d+$")
		if bracketedIpv6 then
			return bracketedIpv6
		end
		return address:match("^([^:]+):%d+$") or "localhost"
	end

	local function isLocalAddress(address)
		address = tostring(address or "")
		return address:sub(1, 2) == "*:"
			or address:match("^127%.0%.0%.1:") ~= nil
			or address:match("^localhost:") ~= nil
			or address:match("^%[::1%]:") ~= nil
			or address:match("^%[::%]:") ~= nil
	end

	local function portUrl(port)
		return "http://" .. (port.host or "localhost") .. ":" .. port.port
	end

	local function portTitle(port)
		return string.format(":%s  %s  pid %s", port.port, port.process, port.pid)
	end

	local function sortPorts(list)
		table.sort(list, function(a, b)
			local portA = tonumber(a.port) or 0
			local portB = tonumber(b.port) or 0
			if portA ~= portB then
				return portA < portB
			end
			if a.process ~= b.process then
				return a.process < b.process
			end
			return tostring(a.pid) < tostring(b.pid)
		end)
	end

	local function parseLsof(output)
		local showAll = settingShowAllInterfaces()
		local parsed = {}
		local byKey = {}
		local pid = nil
		local process = nil

		for line in tostring(output or ""):gmatch("[^\r\n]+") do
			local tag = line:sub(1, 1)
			local value = line:sub(2)

			if tag == "p" then
				pid = value
				process = nil
			elseif tag == "c" then
				process = cleanProcessName(value)
			elseif tag == "n" and pid then
				local port = extractPort(value)
				if port and (showAll or isLocalAddress(value)) then
					local key = pid .. ":" .. port
					local existing = byKey[key]
					if existing then
						table.insert(existing.addresses, value)
						if existing.host == "localhost" and value:match("^127%.0%.0%.1:") then
							existing.address = value
						end
					else
						local item = {
							pid = pid,
							process = process or "unknown",
							port = port,
							address = value,
							addresses = { value },
							host = hostForAddress(value),
						}
						byKey[key] = item
						table.insert(parsed, item)
					end
				end
			end
		end

		sortPorts(parsed)
		return parsed
	end

	local function updateMenus()
		if manager.refreshMenu then
			manager.refreshMenu()
		end
	end

	local function copyText(label, text)
		hs.pasteboard.setContents(text)
		manager.notify(PACKAGE_NAME, label .. " copied", { withdrawAfter = 2 })
	end

	local function openPort(port)
		hs.urlevent.openURL(portUrl(port))
	end

	local function killPort(port)
		local button = hs.dialog.blockAlert(
			"Kill process?",
			string.format("Send SIGTERM to %s (PID %s) listening on port %s?", port.process, port.pid, port.port),
			"Kill",
			"Cancel",
			"critical"
		)
		if button ~= "Kill" then
			return
		end

		status = "killing " .. port.pid
		updateMenus()

		local task = hs.task.new("/bin/kill", function(exitCode, stdout, stderr)
			if exitCode == 0 then
				manager.notify(PACKAGE_NAME, "Stopped " .. port.process .. " on :" .. port.port, { withdrawAfter = 3 })
			else
				manager.notifyError(
					PACKAGE_NAME,
					"Could not kill PID " .. port.pid .. ": " .. tostring(stderr or stdout or "unknown error"),
					{ withdrawAfter = 4 }
				)
			end
			hs.timer.doAfter(0.5, function()
				P.refresh()
			end)
		end, { "-TERM", tostring(port.pid) })

		if not task or not task:start() then
			status = "error"
			manager.notifyError(PACKAGE_NAME, "Could not start kill command", { withdrawAfter = 4 })
			updateMenus()
		end
	end

	local function copyPortDetails(port)
		copyText(
			"Port details",
			table.concat({
				"Port: " .. port.port,
				"URL: " .. portUrl(port),
				"Process: " .. port.process,
				"PID: " .. port.pid,
				"Address: " .. table.concat(port.addresses or { port.address }, ", "),
			}, "\n")
		)
	end

	local function copySummary()
		local lines = {}
		for _, port in ipairs(ports) do
			table.insert(lines, string.format(":%s\t%s\tpid %s", port.port, port.process, port.pid))
		end
		copyText("Port list", table.concat(lines, "\n"))
	end

	local function buildPortMenu(port)
		return {
			{ title = port.address, disabled = true },
			{ title = "Open " .. portUrl(port), fn = function() openPort(port) end },
			{ title = "Copy URL", fn = function() copyText("URL", portUrl(port)) end },
			{ title = "Copy Port", fn = function() copyText("Port", port.port) end },
			{ title = "Copy Details", fn = function() copyPortDetails(port) end },
			{ title = "-" },
			{ title = "Kill Process…", fn = function() killPort(port) end },
		}
	end

	function P.refresh(showLoading)
		if refresh_task then
			return
		end

		if showLoading ~= false then
			status = "scanning"
			updateMenus()
		end

		refresh_task = hs.task.new(LSOF_PATH, function(exitCode, stdout, stderr)
			refresh_task = nil
			local output = stdout or ""
			if exitCode ~= 0 and output == "" and stderr and stderr ~= "" then
				last_error = tostring(stderr)
				status = "error"
				manager.notifyError(PACKAGE_NAME, "Could not read ports: " .. last_error, { withdrawAfter = 4 })
			else
				ports = parseLsof(output)
				last_refresh = os.date("%H:%M:%S")
				last_error = nil
				status = #ports == 1 and "1 port" or tostring(#ports) .. " ports"
			end
			updateMenus()
		end, { "-nP", "-iTCP", "-sTCP:LISTEN", "+c0", "-F", "pcn" })

		if not refresh_task or not refresh_task:start() then
			refresh_task = nil
			last_error = "Could not start lsof"
			status = "error"
			manager.notifyError(PACKAGE_NAME, last_error, { withdrawAfter = 4 })
			updateMenus()
		end
	end

	local function buildMenuItems()
		local menu = {}

		if last_refresh then
			table.insert(menu, { title = "Last refresh: " .. last_refresh, disabled = true })
		end
		if last_error then
			table.insert(menu, { title = "Error: " .. last_error, disabled = true })
		end
		if last_refresh or last_error then
			table.insert(menu, { title = "-" })
		end
		table.insert(menu, { title = "Refresh Now", fn = function() P.refresh(true) end })
		table.insert(menu, { title = "Copy Port List", disabled = #ports == 0, fn = copySummary })
		table.insert(menu, {
			title = settingShowAllInterfaces() and "Show Localhost Ports Only" or "Show All Interfaces",
			fn = function()
				manager.setSetting(PACKAGE_ID, "showAllInterfaces", not settingShowAllInterfaces())
				P.refresh(true)
			end,
		})

		table.insert(menu, { title = "-" })
		if #ports == 0 then
			table.insert(menu, { title = "No listening localhost ports", disabled = true })
		else
			for _, port in ipairs(ports) do
				table.insert(menu, {
					title = portTitle(port),
					menu = buildPortMenu(port),
				})
			end
		end

		return menu
	end

	function P.start()
		P.stop()

		status = "starting"
		P.refresh(true)
		refresh_timer = hs.timer.doEvery(REFRESH_SECONDS, function()
			P.refresh(false)
		end)
	end

	function P.stop()
		if refresh_task then
			pcall(function()
				refresh_task:terminate()
			end)
			refresh_task = nil
		end
		if refresh_timer then
			refresh_timer:stop()
			refresh_timer = nil
		end
		status = "stopped"
	end

	function P.getStatus()
		return status
	end

	function P.getMenuItems()
		return buildMenuItems()
	end

	return P
end
