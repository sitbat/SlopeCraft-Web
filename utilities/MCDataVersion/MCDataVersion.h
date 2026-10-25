/*
 Copyright © 2021-2026  TokiNoBug
This file is part of SlopeCraft.

    SlopeCraft is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    SlopeCraft is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with SlopeCraft. If not, see <https://www.gnu.org/licenses/>.

    Contact with me:
    github:https://github.com/SlopeCraft/SlopeCraft
    bilibili:https://space.bilibili.com/351429231
*/

#ifndef SLOPECRAFT_UTILITIES_MCDATAVERSION_H
#define SLOPECRAFT_UTILITIES_MCDATAVERSION_H

#include <SC_GlobalEnums.h>
#include <vector>
#include <cstdint>
#include <string>

namespace MCDataVersion {

MCDataVersion_t string_to_data_version(const char* str,
                                       bool* ok = nullptr) noexcept;
std::string data_version_to_string(MCDataVersion_t v) noexcept;

MCDataVersion_t max_supported_version(SCL_gameVersion v) noexcept;

MCDataVersion_t min_supported_version(SCL_gameVersion v) noexcept;

MCDataVersion_t suggested_version(SCL_gameVersion v) noexcept;

inline bool is_data_version_suitable(SCL_gameVersion v,
                                     MCDataVersion_t dv) noexcept {
  if (dv < min_supported_version(v) || dv > max_supported_version(v)) {
    return false;
  }

  return true;
}

std::vector<SCL_gameVersion> valid_major_versions() noexcept;

std::string major_version_to_string(SCL_gameVersion v) noexcept;

}  // namespace MCDataVersion
#endif  // SLOPECRAFT_UTILITIES_MCDATAVERSION_H