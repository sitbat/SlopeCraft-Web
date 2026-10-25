//
// Created by Joseph on 2024/9/15.
//

#ifndef SLOPECRAFT_VERSION_SET_H
#define SLOPECRAFT_VERSION_SET_H

#include <cstdint>
#include <bitset>
#include <magic_enum/magic_enum.hpp>

#include "SC_GlobalEnums.h"
#include "SC_game_version_values.hpp"

constexpr inline size_t major_version_to_idx(SCL_gameVersion v) noexcept {
  const auto versions = SC_game_version_values();
  for (size_t i = 0; i < versions.size(); i++) {
    if (v == versions[i]) {
      return i;
    }
  }
  return 31;
}

class version_set {
 private:
  std::bitset<32> set{0};

 public:
  version_set() = default;

  explicit version_set(uint32_t val) : set(val) {}

  static version_set all() noexcept {
    version_set ret(~static_cast<uint32_t>(0));
    return ret;
  }

  inline bool match(SCL_gameVersion v) const noexcept {
    return set[major_version_to_idx(v)];
  }

  inline auto operator[](SCL_gameVersion v) noexcept {
    return set[major_version_to_idx(v)];
  }

  inline auto operator[](SCL_gameVersion v) const noexcept {
    return set[major_version_to_idx(v)];
  }

  inline uint32_t to_u32() const noexcept { return set.to_ulong(); }

  inline bool operator==(const version_set& vs) const noexcept {
    return this->to_u32() == vs.to_u32();
  }

  inline SCL_gameVersion introduced_version() const noexcept {
    for (auto v : SC_game_version_values()) {
      if (match(v)) {
        return v;
      }
    }
    return SCL_gameVersion::FUTURE;
  }
};

#endif  // SLOPECRAFT_VERSION_SET_H
