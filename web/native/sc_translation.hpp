#pragma once
#include <algorithm>
#include <string>
#include <string_view>
#include <sstream>
#include <type_traits>

// This implements the tiny, non-UI subset of QString used by the original
// library's diagnostic messages. All error text stays available in the web core.
namespace sc_web {
class translated_string {
  std::string text_;
 public:
  translated_string(const char* text) : text_(text) {}
  template<class T> translated_string arg(const T& value) const {
    std::ostringstream os;
    os << value;
    auto result = *this;
    size_t first = std::string::npos;
    int lowest = 100;
    for (size_t p = 0; p + 1 < result.text_.size(); ++p) {
      if (result.text_[p] != '%' || result.text_[p + 1] < '1' || result.text_[p + 1] > '9') continue;
      int number = result.text_[p + 1] - '0';
      if (p + 2 < result.text_.size() && result.text_[p + 2] >= '0' && result.text_[p + 2] <= '9')
        number = number * 10 + result.text_[p + 2] - '0';
      if (number < lowest) { lowest = number; first = p; }
    }
    if (first == std::string::npos) return result;
    const auto token = "%" + std::to_string(lowest);
    for (size_t p = 0; (p = result.text_.find(token, p)) != std::string::npos;) {
      if (p + token.size() < result.text_.size() && result.text_[p + token.size()] >= '0' && result.text_[p + token.size()] <= '9') {
        p += token.size(); continue;
      }
      result.text_.replace(p, token.size(), os.str());
      p += os.str().size();
    }
    return result;
  }
  const std::string& toStdString() const { return text_; }
};
}
