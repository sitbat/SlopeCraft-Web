#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <thread>
#include <vector>

namespace sc_web {
inline unsigned worker_count = 4;
inline uint64_t memory_budget_bytes = uint64_t{1536} * 1024 * 1024;
inline std::atomic<unsigned> last_workers{0};
inline std::atomic<unsigned> last_working_workers{0};
inline std::array<uint64_t,8> last_worker_items{};
// Called only from the dedicated engine Worker; wasm pthreads execute disjoint
// output ranges against shared linear memory. No single-thread build is shipped.
template<class Function> void parallel_for(size_t size, Function&& function) {
  if (!size) return;
  const unsigned count = std::min<size_t>(worker_count, size);
  last_workers.store(count, std::memory_order_relaxed);
  last_working_workers.store(0, std::memory_order_relaxed);
  last_worker_items.fill(0);
  std::atomic<size_t> next{0};
  auto run = [&](unsigned worker_index) {
    constexpr size_t chunk = 16;
    bool processed = false;
    for (;;) {
      const size_t start = next.fetch_add(chunk, std::memory_order_relaxed);
      if (start >= size) return;
      if (!processed) {
        last_working_workers.fetch_add(1,std::memory_order_relaxed);
        processed = true;
      }
      for (size_t i = start; i < std::min(start + chunk, size); ++i) {
        function(i);
        ++last_worker_items[worker_index];
      }
    }
  };
  std::vector<std::thread> workers;
  workers.reserve(count);
  for (unsigned i = 0; i < count; ++i) workers.emplace_back(run,i);
  for (auto& worker : workers) worker.join();
}
}
