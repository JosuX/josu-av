-- AV Control: live bitrate
--
-- Lets the AV Control panel change the stream's video bitrate without restarting the stream.
-- Add it in OBS under Tools -> Scripts. Every second it:
--   * reads the bitrate the panel wants from <dir>/obs-bitrate and, while streaming, applies it
--     to the running video encoder (x264 and NVENC change bitrate on the fly);
--   * writes what the encoder runs at to <dir>/obs-bitrate-status, which tells the panel the
--     script is loaded.
-- <dir> defaults to the panel's state directory, ~/.local/state/av-control.

obs = obslua

local dir = ""
local last_applied = nil

local function default_dir()
  local state = os.getenv("XDG_STATE_HOME")
  if state == nil or state == "" then
    state = (os.getenv("HOME") or "") .. "/.local/state"
  end
  return state .. "/av-control"
end

local function read_request()
  local f = io.open(dir .. "/obs-bitrate", "r")
  if f == nil then
    return nil
  end
  local line = f:read("*l")
  f:close()
  return tonumber(line)
end

local function write_status(active, encoder_id, bitrate)
  local path = dir .. "/obs-bitrate-status"
  local f = io.open(path .. ".tmp", "w")
  if f == nil then
    return -- The panel creates the directory; nothing to report to until it does.
  end
  f:write("ts=" .. os.time() .. "\n")
  f:write("active=" .. tostring(active) .. "\n")
  f:write("encoder=" .. (encoder_id or "") .. "\n")
  f:write("bitrate=" .. (bitrate and tostring(bitrate) or "") .. "\n")
  f:close()
  os.rename(path .. ".tmp", path)
end

local function tick()
  local output = obs.obs_frontend_get_streaming_output()
  if output == nil then
    last_applied = nil
    write_status(false, nil, nil)
    return
  end

  local encoder = nil
  if obs.obs_output_active(output) then
    encoder = obs.obs_output_get_video_encoder(output)
  end
  if encoder == nil then
    last_applied = nil
    obs.obs_output_release(output)
    write_status(false, nil, nil)
    return
  end

  local settings = obs.obs_encoder_get_settings(encoder)
  local current = obs.obs_data_get_int(settings, "bitrate")
  local wanted = read_request()
  if wanted ~= nil and wanted ~= last_applied and wanted ~= current then
    obs.obs_data_set_int(settings, "bitrate", wanted)
    obs.obs_encoder_update(encoder, settings)
    obs.script_log(obs.LOG_INFO, "video bitrate " .. current .. " -> " .. wanted .. " kbps")
    current = wanted
  end
  last_applied = wanted
  obs.obs_data_release(settings)

  write_status(true, obs.obs_encoder_get_id(encoder), current)
  obs.obs_output_release(output)
end

function script_description()
  return "<b>AV Control: live bitrate</b><br>Lets the AV Control panel change the stream bitrate "
    .. "without restarting the stream. Leave the folder empty to use ~/.local/state/av-control."
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_path(props, "dir", "Panel state folder", obs.OBS_PATH_DIRECTORY, nil, nil)
  return props
end

function script_update(settings)
  local d = obs.obs_data_get_string(settings, "dir")
  if d == nil or d == "" then
    d = default_dir()
  end
  dir = d
  last_applied = nil
end

function script_load(settings)
  script_update(settings)
  obs.timer_add(tick, 1000)
end

function script_unload()
  obs.timer_remove(tick)
end
