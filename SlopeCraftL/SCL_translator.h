/*
    Copyright © 2021-2026 year  TokiNoBug
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
*/

#ifndef SLOPECRAFT_SCL_TR_H
#define SLOPECRAFT_SCL_TR_H

#ifdef SLOPECRAFT_WEB
#include <sc_translation.hpp>
#else
#include <QObject>
#include <QString>
#endif

namespace SlopeCraft {

#ifdef SLOPECRAFT_WEB
class SCLTranslator {
 public:
  static sc_web::translated_string tr(const char* text) { return {text}; }
};
#else
class SCLTranslator : public QObject {
  Q_OBJECT
 public:
  SCLTranslator() = default;
  ~SCLTranslator() override = default;
};
#endif

}  // namespace SlopeCraft

#endif  // SLOPECRAFT_SCL_TR_H
