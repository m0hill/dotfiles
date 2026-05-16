pcall(require, "hs.ipc")

local controllerFactory = dofile(hs.configdir .. "/packages/manager/init.lua")

if _G.__automation_controller and _G.__automation_controller.stop then
	_G.__automation_controller:stop()
end

_G.__automation_controller = controllerFactory({
	configDir = hs.configdir,
})

_G.__automation_controller:start()
