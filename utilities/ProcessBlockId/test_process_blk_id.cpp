#include <process_block_id.h>

#include <iostream>

using std::cout, std::endl;

bool run_single_test(std::string_view str) noexcept;

bool run_match_test();

int main(int, char**) {
  const std::string_view str[] = {
    "",
    "stone",
    "dirt[variant=coarse_dirt,snowy=false]",
    "minecraft:stone",
    "minecraft:blue_concrete",
    "minecraft:concrete[color=light_blue]",
    "minecraft:red_sandstone[type=smooth_red_sandstone]",
    "minecraft:dirt[variant=coarse_dirt,snowy=false]",
    "minecraft:mushroom_stem[east=true,west=true,north=true,south=true,up="
    "true,down=true]"};

  for (auto& id : str) {
    if (not run_single_test(id)) {
      return 1;
    }
  }

  if (not run_match_test()) {
    return 2;
  }

  return 0;
}

bool run_single_test(std::string_view str) noexcept {
  std::string namespace_name, pure_id;
  std::vector<std::pair<std::string, std::string>> attributes;

  if (!blkid::process_blk_id(str, &namespace_name, &pure_id, &attributes)) {
    return false;
  }

  cout << "namespace name = " << namespace_name << ", pure id = " << pure_id
       << '\n';

  for (auto& pair : attributes) {
    cout << "    " << pair.first << " = " << pair.second << '\n';
  }
  cout << endl;

  return true;
}

bool run_match_test() {
  struct match_task {
    std::string parent_id;
    std::string detail_id;
    bool should_pass;
  };

  std::vector<match_task> tasks{
    {"minecraft:stone", "minecraft:stone", true},
    {"stone", "minecraft:stone", true},
    {"stone", "minecraft:not_stone", false},
    {"stone", "minecraft:stone[]", true},
    {"minecraft:stone", "minecraft:stone[key=value]", true},
    {"minecraft:stone", "stone", false},
    {"minecraft:concrete[color=white]", "minecraft:concrete[color=white]",
     true},
    {"minecraft:concrete[color=white]", "minecraft:concrete[color=black]",
     false},
    {"minecraft:mushroom_stem",
     "minecraft:mushroom_stem[east=true,west=true,"
     "north=true,south=true,up=true,down=true]",
     true},
    {"mushroom_stem",
     "minecraft:mushroom_stem[east=true,west=true,"
     "north=true,south=true,up=true,down=true]",
     true},
    {"minecraft:mushroom_stem[east=true,west=true]",
     "minecraft:mushroom_stem[east=true,west=true,"
     "north=true,south=true,up=true,down=true]",
     true},
    {"minecraft:mushroom_stem[west=true,east=false]",
     "minecraft:mushroom_stem[east=true,west=true,"
     "north=true,south=true,up=true,down=true]",
     false},
  };

  for (const auto& task : tasks) {
    const auto detail = blkid::parse_block_id(task.detail_id).value();
    const auto parent = blkid::parse_block_id(task.parent_id).value();
    const bool match = detail.is_derived_from(parent);
    if (match not_eq task.should_pass) {
      return false;
    }
  }
  return true;
}