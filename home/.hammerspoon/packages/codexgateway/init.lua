--- Codex Gateway
--- Monitor and control the codex-gateway user LaunchAgents.
---
--- @package codexgateway

return function(manager)
	local P = {}
	local PACKAGE_ID = "codexgateway"
	local PACKAGE_NAME = "Codex Gateway"
	local HOME = assert(os.getenv("HOME"), "HOME is not set")
	local DOMAIN = "gui/" .. tostring(hs.execute("/usr/bin/id -u") or ""):gsub("%s+$", "")
	local LOCAL_HEALTH_URL = "http://127.0.0.1:43129/health"
	local PUBLIC_HEALTH_URL = "https://codex-gateway.mohil.dev/health"
	local REFRESH_SECONDS = 10

	local services = {
		gateway = {
			name = "Gateway",
			label = "com.m0hill.codex-gateway",
			plist = HOME .. "/Library/LaunchAgents/com.m0hill.codex-gateway.plist",
			errorLog = HOME .. "/Library/Logs/codex-gateway.error.log",
			status = "checking",
			loaded = false,
			busy = false,
			statusTask = nil,
			commandTask = nil,
		},
		tunnel = {
			name = "Tunnel",
			label = "com.m0hill.codex-gateway-tunnel",
			plist = HOME .. "/Library/LaunchAgents/com.m0hill.codex-gateway-tunnel.plist",
			errorLog = HOME .. "/Library/Logs/codex-gateway-tunnel.error.log",
			status = "checking",
			loaded = false,
			busy = false,
			statusTask = nil,
			commandTask = nil,
		},
	}

	local refresh_timer = nil
	local health_status = {
		localGateway = "checking",
		publicGateway = "checking",
	}
	local refresh_generation = 0

	local function refreshMenu()
		if manager.refreshMenu then
			manager.refreshMenu()
		end
	end

	local function openPath(path)
		local task = hs.task.new("/usr/bin/open", nil, { path })
		if task then
			task:start()
		end
	end

	local function serviceTarget(service)
		return DOMAIN .. "/" .. service.label
	end

	local function setServiceStatus(service, value)
		service.status = value
		refreshMenu()
	end

	local function updateHealth(name, url, generation)
		health_status[name] = "checking"
		hs.http.asyncGet(url, nil, function(code)
			if generation ~= refresh_generation then
				return
			end
			health_status[name] = code == 200 and "ok" or ("HTTP " .. tostring(code or "error"))
			refreshMenu()
		end)
	end

	function P.refreshHealth()
		local generation = refresh_generation
		updateHealth("localGateway", LOCAL_HEALTH_URL, generation)
		updateHealth("publicGateway", PUBLIC_HEALTH_URL, generation)
	end

	local function refreshService(service)
		if service.statusTask or service.busy then
			return
		end

		local generation = refresh_generation
		service.statusTask = hs.task.new("/bin/launchctl", function(exitCode)
			service.statusTask = nil
			if generation ~= refresh_generation then
				return
			end
			service.loaded = exitCode == 0
			service.status = service.loaded and "loaded" or "stopped"
			refreshMenu()
		end, { "list", service.label })

		if not service.statusTask or not service.statusTask:start() then
			service.statusTask = nil
			setServiceStatus(service, "status error")
		end
	end

	function P.refresh()
		refresh_generation = refresh_generation + 1
		for _, service in pairs(services) do
			refreshService(service)
		end
		P.refreshHealth()
	end

	local function runLaunchctl(service, action, args)
		if service.commandTask then
			return
		end

		service.busy = true
		setServiceStatus(service, action)
		service.commandTask = hs.task.new("/bin/launchctl", function(exitCode, stdout, stderr)
			service.commandTask = nil
			service.busy = false
			if exitCode == 0 then
				manager.notify(PACKAGE_NAME, service.name .. " " .. action .. " complete", { withdrawAfter = 2 })
			else
				local message = tostring((stderr or "") ~= "" and stderr or stdout or "launchctl failed"):gsub("%s+$", "")
				manager.notifyError(PACKAGE_NAME, service.name .. ": " .. message, { withdrawAfter = 4 })
			end
			hs.timer.doAfter(0.5, P.refresh)
		end, args)

		if not service.commandTask or not service.commandTask:start() then
			service.commandTask = nil
			service.busy = false
			setServiceStatus(service, "command error")
			manager.notifyError(PACKAGE_NAME, "Could not start launchctl", { withdrawAfter = 4 })
		end
	end

	local function startService(service)
		if service.loaded then
			runLaunchctl(service, "starting", { "kickstart", serviceTarget(service) })
		else
			runLaunchctl(service, "starting", { "bootstrap", DOMAIN, service.plist })
		end
	end

	local function restartService(service)
		if service.loaded then
			runLaunchctl(service, "restarting", { "kickstart", "-k", serviceTarget(service) })
		else
			startService(service)
		end
	end

	local function stopService(service)
		if not service.loaded then
			return
		end
		runLaunchctl(service, "stopping", { "bootout", serviceTarget(service) })
	end

	local function anyBusy()
		return services.gateway.busy or services.tunnel.busy
	end

	local function startAll()
		startService(services.gateway)
		hs.timer.doAfter(1, function()
			startService(services.tunnel)
		end)
	end

	local function restartAll()
		restartService(services.gateway)
		hs.timer.doAfter(1, function()
			restartService(services.tunnel)
		end)
	end

	local function stopAll()
		stopService(services.tunnel)
		hs.timer.doAfter(1, function()
			stopService(services.gateway)
		end)
	end

	function P.start()
		P.stop()
		for _, service in pairs(services) do
			service.status = "checking"
		end
		P.refresh()
		refresh_timer = hs.timer.doEvery(REFRESH_SECONDS, P.refresh)
	end

	function P.stop()
		refresh_generation = refresh_generation + 1
		for _, service in pairs(services) do
			if service.statusTask and service.statusTask:isRunning() then
				service.statusTask:terminate()
			end
			if service.commandTask and service.commandTask:isRunning() then
				service.commandTask:terminate()
			end
			service.statusTask = nil
			service.commandTask = nil
			service.busy = false
		end
		if refresh_timer then
			refresh_timer:stop()
		end
		refresh_timer = nil
	end

	local function overallStatus()
		if services.gateway.busy or services.tunnel.busy then
			return "working"
		end
		if services.gateway.loaded and services.tunnel.loaded and health_status.publicGateway == "ok" then
			return "ok"
		end
		if services.gateway.status == "checking" or services.tunnel.status == "checking" or health_status.publicGateway == "checking" then
			return "checking"
		end
		return "attention"
	end

	function P.getStatus()
		return overallStatus()
	end

	local function serviceState(service)
		if service.busy then
			return service.status
		end
		return service.loaded and "running" or "stopped"
	end

	local function serviceMenuItems(service)
		return {
			{ title = "State: " .. serviceState(service), disabled = true },
			{ title = "Start", disabled = service.busy or service.loaded, fn = function() startService(service) end },
			{ title = "Restart", disabled = service.busy or not service.loaded, fn = function() restartService(service) end },
			{ title = "Stop", disabled = service.busy or not service.loaded, fn = function() stopService(service) end },
			{ title = "-" },
			{ title = "Open Error Log", fn = function() openPath(service.errorLog) end },
		}
	end

	function P.getMenuItems()
		return {
			{ title = "Status: " .. overallStatus() .. " (public " .. health_status.publicGateway .. ")", disabled = true },
			{ title = "Refresh", disabled = anyBusy(), fn = P.refresh },
			{ title = "Start All", disabled = anyBusy(), fn = startAll },
			{ title = "Restart All", disabled = anyBusy(), fn = restartAll },
			{ title = "Stop All", disabled = anyBusy(), fn = stopAll },
			{ title = "-" },
			{ title = "Gateway", menu = serviceMenuItems(services.gateway) },
			{ title = "Tunnel", menu = serviceMenuItems(services.tunnel) },
			{ title = "-" },
			{ title = "Open Public Health", fn = function() hs.urlevent.openURL(PUBLIC_HEALTH_URL) end },
		}
	end

	return P
end
