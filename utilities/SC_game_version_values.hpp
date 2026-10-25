#pragma once
#include "SC_GlobalEnums.h"
#include <array>
#include <optional>
#include <string_view>
#ifndef SLOPECRAFT_WEB
#include <magic_enum/magic_enum.hpp>
#endif

// Reflect the sparse major-version enum explicitly on WebAssembly. A numeric
// reflection scan to 65535 in every translation unit greatly increases build
// time and drops 26.x/FUTURE if magic_enum's normal short range is used instead.
constexpr auto SC_game_version_values() noexcept {
#ifdef SLOPECRAFT_WEB
  return std::array{SCL_gameVersion::ANCIENT,SCL_gameVersion::MC12,
    SCL_gameVersion::MC13,SCL_gameVersion::MC14,SCL_gameVersion::MC15,
    SCL_gameVersion::MC16,SCL_gameVersion::MC17,SCL_gameVersion::MC18,
    SCL_gameVersion::MC19,SCL_gameVersion::MC20,SCL_gameVersion::MC21,
    SCL_gameVersion::MC26_1,SCL_gameVersion::MC26_2,SCL_gameVersion::FUTURE};
#else
  return magic_enum::enum_values<SCL_gameVersion>();
#endif
}
#ifdef SLOPECRAFT_WEB
inline std::optional<SCL_gameVersion> SC_parse_game_version(std::string_view text) {
  constexpr std::array names{"ANCIENT","MC12","MC13","MC14","MC15","MC16","MC17","MC18","MC19","MC20","MC21","MC26_1","MC26_2","FUTURE"};
  constexpr auto versions=SC_game_version_values();
  for(size_t i=0;i<names.size();++i) if(text==names[i]) return versions[i];
  if(text=="MIN_VALID") return SCL_gameVersion::MIN_VALID;
  if(text=="MAX_VALID") return SCL_gameVersion::MAX_VALID;
  return std::nullopt;
}
inline std::optional<SCL_gameVersion> SC_parse_game_version(int value) {
  for(auto version:SC_game_version_values()) if(static_cast<int>(version)==value) return version;
  return std::nullopt;
}
#endif
