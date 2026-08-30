#!/usr/bin/env sh

usf_env_root=$(git rev-parse --show-toplevel) || return 1
export USF_ROOT="$usf_env_root"
export USF_PROVIDER_HOME="$USF_ROOT/.usf/home"
export TMPDIR="$USF_ROOT/.usf/tmp"
export XDG_CACHE_HOME="$USF_ROOT/.usf/xdg/cache"
export XDG_CONFIG_HOME="$USF_ROOT/.usf/xdg/config"
export XDG_DATA_HOME="$USF_ROOT/.usf/xdg/data"
export XDG_STATE_HOME="$USF_ROOT/.usf/xdg/state"
export npm_config_cache="$USF_ROOT/.usf/cache/npm"
export COREPACK_HOME="$USF_ROOT/.usf/cache/corepack"
export PNPM_HOME="$USF_ROOT/.usf/bin"
unset usf_env_root
