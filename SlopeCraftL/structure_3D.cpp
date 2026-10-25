//
// Created by joseph on 4/17/24.
//
#include <format>
#include <boost/iostreams/filtering_stream.hpp>
#include <boost/iostreams/device/file.hpp>
#include <boost/iostreams/filter/zstd.hpp>
#include <zstd.h>
#include <cereal/cereal.hpp>
#include <cereal/archives/binary.hpp>
#include <magic_enum/magic_enum.hpp>

#include "structure_3D.h"
#include "color_table.h"
#include "lossy_compressor.h"
#include "prim_glass_builder.h"
#include "FlatDiagram.h"
#include "SCL_translator.h"

std::optional<structure_3D_impl> structure_3D_impl::create(
    const color_table_impl& table, const converted_image_impl& cvted,
    const build_options& option) noexcept {
  if (option.max_allowed_height < 14) {
    option.ui.report_error(
        errorFlag::MAX_ALLOWED_HEIGHT_LESS_THAN_14,
        SCLTranslator::tr("允许最大高度应该不低于14，但是遇到了%1")
            .arg(option.max_allowed_height)
            .toStdString()
            .c_str()
        // std::format("Max allowed height should be >= 14, but found {}",
        //             option.max_allowed_height).c_str()
    );
    return std::nullopt;
  }
  structure_3D_impl ret;
  // set up basic infos
  {
    ret.schem.set_MC_major_version_number(table.mc_version_);
    ret.schem.set_MC_version_number(
        MCDataVersion::suggested_version(table.mc_version_));
    auto id = table.block_id_list(true);
    ret.schem.set_block_id(id);
  }

  build_options fixed_opt = option;
  if (table.is_flat() || !table.is_vanilla()) {
    fixed_opt.compress_method = compressSettings::noCompress;
    fixed_opt.glass_method = glassBridgeSettings::noBridge;
  }
  fixed_opt.ui.report_working_status(workStatus::buidingHeighMap);
  fixed_opt.main_progressbar.set_range(0, 10 * cvted.size(), 0);
  {
    std::unordered_map<rc_pos, water_y_range> water_list;
    fixed_opt.main_progressbar.add(cvted.size());
  }

  Eigen::ArrayXXi map_color, base_color, high_map, low_map;
  std::unordered_map<rc_pos, water_y_range> water_list;
  {
    auto opt = cvted.height_info(table, fixed_opt);
    if (!opt) {
      return std::nullopt;
    }
    map_color = std::move(opt.value().map_color);
    base_color = std::move(opt.value().base);
    high_map = std::move(opt.value().high_map);
    low_map = std::move(opt.value().low_map);
    water_list = std::move(opt.value().water_list);
  }
  assert((high_map >= low_map).all());
  assert(low_map.minCoeff() == 0);

#ifdef SLOPECRAFT_WEB
  // Account for the dense tensor before resize; browser allocation failures can
  // otherwise terminate a wasm module before a useful error reaches the UI.
  const uint64_t tensor_bytes = uint64_t(2 + cvted.cols()) *
      uint64_t(high_map.maxCoeff() + 1) * uint64_t(2 + cvted.rows()) *
      sizeof(libSchem::Schem::ele_t);
  if (tensor_bytes > sc_web::memory_budget_bytes) {
    const auto message = std::format(
      "三维结构本身需要 {:.1f} MiB，超过当前任务内存预算 {:.1f} MiB。请降低高度、压缩或拆分图片。",
      tensor_bytes / 1048576.0, sc_web::memory_budget_bytes / 1048576.0);
    option.ui.report_error(errorFlag::MEMORY_ALLOCATE_FAILED, message.c_str());
    return std::nullopt;
  }
#endif
  try {
    ret.schem.resize(2 + cvted.cols(), high_map.maxCoeff() + 1,
                     2 + cvted.rows());
    ret.schem.set_zero();
  } catch (const std::bad_alloc& e) {
    const std::array<uint64_t, 3> shape{
      2 + cvted.cols(), static_cast<uint64_t>(high_map.maxCoeff() + 1),
      2 + cvted.rows()};
    const uint64_t bytes_required = shape[0] * shape[1] * shape[2];
    option.ui.report_error(
        errorFlag::MEMORY_ALLOCATE_FAILED,
        SCLTranslator::tr("分配内存失败，需要%1GiB。详情：\"%2\"")
            .arg(static_cast<double>(bytes_required))
            .arg(e.what())
            .toStdString()
            .c_str()
        // std::format("Failed to allocate memory for this structure, "
        //             "required {} GiB. The exception says: \"{}\"",
        //             static_cast<double>(bytes_required) / (uint64_t{1} <<
        //             30), e.what()).c_str()
    );
    return std::nullopt;
  }
  // make 3D
  {
    // base_color(r+1,c)<->High(r+1,c)<->Build(c+1,High(r+1,c),r+1)
    // 为了区分玻璃与空气，张量中存储的是 Base+1.所以元素为 1 对应着玻璃，0
    // 对应空气

    // 水柱周围的玻璃
    for (auto it = water_list.begin(); it != water_list.end(); ++it) {
      const int x = it->first.col + 1;
      const int z = it->first.row;
      const int y = it->second.high_y;
      const int yLow = it->second.low_y;
      ret.schem(x, y + 1, z) = 0 + 1;  // 柱顶玻璃
      for (int yDynamic = yLow; yDynamic <= y; yDynamic++) {
        ret.schem(x - 1, yDynamic, z - 0) = 1;
        ret.schem(x + 1, yDynamic, z + 0) = 1;
        ret.schem(x + 0, yDynamic, z - 1) = 1;
        ret.schem(x + 0, yDynamic, z + 1) = 1;
      }
      if (yLow >= 1) {
        ret.schem(x, yLow - 1, z) = 1;
      }  // 柱底玻璃
    }

    fixed_opt.main_progressbar.add(cvted.size());

    // std::println("{} rows, {} cols", cvted.rows(), cvted.cols());
    //  Common blocks
    for (int64_t r = -1; r < static_cast<int64_t>(cvted.rows()); r++) {
      for (int64_t c = 0; c < static_cast<int64_t>(cvted.cols()); c++) {
        // std::println("r = {}, c = {}", r, c);
        const int cur_base_color = base_color(r + 1, c);
        if (cur_base_color == 12 || cur_base_color == 0) {
          // water or air
          continue;
        }
        const int x = c + 1;
        const int y = high_map(r + 1, c);
        const int z = r + 1;
        if (y >= 1) {
          auto& blk = table.blocks[base_color(r + 1, c)];
          if (blk.needGlass) {
            ret.schem(x, y - 1, z) = 0 + 1;
          }
          if (blk.needStone[table.mc_version_]) {
            ret.schem(x, y - 1, z) = 11 + 1;
          }
        }
        const bool fire_proof =
            fixed_opt.fire_proof && table.blocks[base_color(r + 1, c)].burnable;
        const bool enderman_proof =
            fixed_opt.enderman_proof &&
            table.blocks[base_color(r + 1, c)].endermanPickable;
        if (fire_proof || enderman_proof) {
          if (y >= 1 && ret.schem(x, y - 1, z) == 0)
            ret.schem(x, y - 1, z) = 0 + 1;
          if (x >= 1 && ret.schem(x - 1, y, z) == 0)
            ret.schem(x - 1, y, z) = 0 + 1;
          if (z >= 1 && ret.schem(x, y, z - 1) == 0)
            ret.schem(x, y, z - 1) = 0 + 1;
          if (y + 1 < ret.schem.y_range() && ret.schem(x, y + 1, z) == 0)
            ret.schem(x, y + 1, z) = 0 + 1;
          if (x + 1 < ret.schem.x_range() && ret.schem(x + 1, y, z) == 0)
            ret.schem(x + 1, y, z) = 0 + 1;
          if (z + 1 < ret.schem.z_range() && ret.schem(x, y, z + 1) == 0)
            ret.schem(x, y, z + 1) = 0 + 1;
        }

        ret.schem(x, y, z) = cur_base_color + 1;
      }
      fixed_opt.main_progressbar.add(cvted.cols());
    }

    fixed_opt.main_progressbar.add(cvted.size());

    for (auto it = water_list.cbegin(); it != water_list.cend(); ++it) {
      const int x = it->first.col + 1;
      const int z = it->first.row;
      const int y = it->second.high_y;
      const int yLow = it->second.low_y;
      for (int yDynamic = yLow; yDynamic <= y; yDynamic++) {
        ret.schem(x, yDynamic, z) = 13;
      }
    }
  }
  fixed_opt.main_progressbar.set_range(0, 9 * cvted.size(), 8 * cvted.size());
  // build bridges
  if (table.map_type() == mapTypes::Slope &&
      fixed_opt.glass_method == glassBridgeSettings::withBridge) {
    fixed_opt.ui.report_working_status(workStatus::constructingBridges);

    fixed_opt.sub_progressbar.set_range(0, 100, 0);
    const int step = cvted.size() / ret.schem.y_range();

    prim_glass_builder glass_builder;
    glass_builder.ui = fixed_opt.ui;
    glass_builder.progress_bar = fixed_opt.sub_progressbar;
    fixed_opt.ui.keep_awake();
    for (uint32_t y = 0; y < ret.schem.y_range(); y++) {
      fixed_opt.sub_progressbar.add(step);
      if (y % (fixed_opt.bridge_interval + 1) == 0) {
        std::array<int, 3> start, extension;  // x,z,y
        start[0] = 0;
        start[1] = 0;
        start[2] = y;
        extension[0] = ret.schem.x_range();
        extension[1] = ret.schem.z_range();
        extension[2] = 1;
        TokiMap targetMap =
            ySlice2TokiMap_u16(ret.schem.tensor(), start, extension);
        glassMap glass;
        glass = glass_builder.makeBridge(targetMap);
        for (int r = 0; r < glass.rows(); r++)
          for (int c = 0; c < glass.cols(); c++)
            if (ret.schem(r, y, c) == prim_glass_builder::air &&
                glass(r, c) == prim_glass_builder::glass)
              ret.schem(r, y, c) = prim_glass_builder::glass;
      } else {
        continue;
      }
    }
    fixed_opt.ui.keep_awake();
    fixed_opt.sub_progressbar.set_range(0, 100, 100);
  }

  if (fixed_opt.connect_mushrooms) {
    ret.schem.process_mushroom_states();
  }
  // Add supporting block
  if (fixed_opt.support_block_settings not_eq SCL_supportBlockSettings::none) {
    for (int64_t r = -1; r < static_cast<int64_t>(cvted.rows()); r++) {
      for (int64_t c = 0; c < static_cast<int64_t>(cvted.cols()); c++) {
        const int cur_base_color = base_color(r + 1, c);
        if (cur_base_color == 12 || cur_base_color == 0) {
          // water or air
          continue;
        }
        const int x = c + 1;
        // Pos for color-showing block
        const int y = high_map(r + 1, c);
        const int z = r + 1;
        if (y <= 0) {
          continue;
        }
        if (ret.schem(x, y - 1, z) not_eq 0) {
          continue;
        }
        switch (fixed_opt.support_block_settings) {
          case SCL_supportBlockSettings::stone:
            ret.schem(x, y - 1, z) = 11 + 1;
            break;
          case SCL_supportBlockSettings::transparent:
            ret.schem(x, y - 1, z) = 0 + 1;
            break;
          case SCL_supportBlockSettings::none:
            break;
        }
      }
    }
  }

  {
    const auto shrink_result = ret.schem.remove_unused_ids();
    if (not shrink_result) {
      fixed_opt.ui.report_error(SCL_errorFlag::EXPORT_SCHEM_HAS_INVALID_BLOCKS,
                                shrink_result.error().c_str());
      return std::nullopt;
    }
  }

  fixed_opt.main_progressbar.set_range(0, 9 * cvted.size(), 9 * cvted.size());
  fixed_opt.ui.report_working_status(workStatus::none);

  ret.map_color = map_color.cast<uint8_t>();
  return ret;
}

bool structure_3D_impl::export_litematica(
    const char* filename,
    const SlopeCraft::litematic_options& option) const noexcept {
  option.ui.report_working_status(workStatus::writingMetaInfo);
  option.progressbar.set_range(0, 100 + this->schem.size(), 0);
  libSchem::litematic_info info{};
  info.lite_name_utf8 = option.litename_utf8;
  info.region_name_utf8 = option.region_name_utf8;

  {
    auto res = this->schem.export_litematic(filename, info);

    if (not res) {
      option.ui.report_error(res.error().first, res.error().second.c_str());
      return false;
    }
  }
  option.ui.report_working_status(workStatus::none);
  option.progressbar.set_range(0, 100, 100);
  return true;
}

bool structure_3D_impl::export_vanilla_structure(
    const char* filename,
    const SlopeCraft::vanilla_structure_options& option) const noexcept {
  option.ui.report_working_status(workStatus::writingMetaInfo);
  option.progressbar.set_range(0, 100 + schem.size(), 0);

  auto res = schem.export_structure(filename, option.is_air_structure_void);
  if (not res) {
    option.ui.report_error(res.error().first, res.error().second.c_str());
    return false;
  }

  option.progressbar.set_range(0, 100, 100);
  option.ui.report_working_status(workStatus::none);
  return true;
}

bool structure_3D_impl::export_WE_schem(
    const char* filename,
    const SlopeCraft::WE_schem_options& option) const noexcept {
  option.progressbar.set_range(0, 100, 0);

  libSchem::WorldEditSchem_info info;

  info.schem_name_utf8 = "GeneratedBySlopeCraftL";
  memcpy(info.offset.data(), option.offset, sizeof(info.offset));
  memcpy(info.WE_offset.data(), option.we_offset, sizeof(info.WE_offset));

  info.required_mods_utf8.resize(option.num_required_mods);

  for (int idx = 0; idx < option.num_required_mods; idx++) {
    info.required_mods_utf8[idx] = option.required_mods_name_utf8[idx];
  }

  option.progressbar.set_range(0, 100, 5);

  auto res = schem.export_WESchem(filename, info);
  if (not res) {
    option.ui.report_error(res.error().first, res.error().second.c_str());
    return false;
  }

  option.progressbar.set_range(0, 100, 100);
  return true;
}

bool structure_3D_impl::export_flat_diagram(
    const char* filename, const SlopeCraft::color_table& table_,
    const SlopeCraft::flag_diagram_options& option) const noexcept {
  const auto& table = dynamic_cast<const color_table_impl&>(table_);
  if (table.map_type() != SCL_mapTypes::Flat) {
    option.ui.report_error(
        SCL_errorFlag::EXPORT_FLAT_DIAGRAM_ON_WRONG_MAP_TYPE,
        SCLTranslator::tr(
            "SlopeCraftL只能把平面地图画导出为平面示意图，但是遇到了%1")
            .arg(magic_enum::enum_name(table.map_type()).data())
            .toStdString()
            .c_str()
        // std::format(
        //     "We can only export flat diagram for flat maps, but found {}",
        //     magic_enum::enum_name(table.map_type())).c_str()
    );
    return false;
  }
  const libFlatDiagram::fd_option fdopt{
    .row_start = 0,
    .row_end = this->schem.z_range(),
    .cols = this->schem.x_range(),
    .split_line_row_margin = option.split_line_row_margin,
    .split_line_col_margin = option.split_line_col_margin,
    .png_compress_level = option.png_compress_level,
    .png_compress_memory_level = option.png_compress_memory_level,
  };

  std::vector<Eigen::Array<uint32_t, 16, 16, Eigen::RowMajor>> img_list_rmj;
  img_list_rmj.reserve(this->schem.palette_size());

  color_table_searching_index block_indexer;
  {
    auto indexer_opt =
        dynamic_cast<const color_table_impl&>(table_).build_indexer();
    if (not indexer_opt) {
      option.ui.report_error(errorFlag::EXPORT_FLAT_DIAGRAM_FAILURE,
                             SCLTranslator::tr("SlopeCraftL内部错误：%1")
                                 .arg(indexer_opt.error().c_str())
                                 .toStdString()
                                 .c_str()
                             // std::format("SlopeCraftL internal error. {}",
                             // indexer_opt.error()).c_str()
      );
      return false;
    }
    block_indexer = std::move(indexer_opt.value());
  }
  for (size_t pblkid = 0; pblkid < this->schem.palette_size(); pblkid++) {
    if (pblkid == 0) {  // air
      img_list_rmj.emplace_back();
      img_list_rmj[0].setZero();
      continue;
    }
    std::string_view id = this->schem.palette()[pblkid];
    const mc_block* blkp = block_indexer.find(id);
    //    const mc_block *blkp = table.find_block_for_index(pblkid - 1, id);
    if (blkp == nullptr) {
      std::string blkid_full;
      blkid_full.reserve(64 * 2048);
      for (const auto& blk : table.blocks) {
        blkid_full += blk.id;
        blkid_full.push_back('\n');
      }
      option.ui.report_error(
          errorFlag::EXPORT_FLAT_DIAGRAM_FAILURE,
          SCLTranslator::tr(
              "SlopeCraftL内部错误。无法找到与方块%"
              "1匹配的图像。3D结构中对应的方块索引为%2。整个方块列表如下：%3")
              .arg(id.data())
              .arg(pblkid)
              .arg(blkid_full.c_str())
              .toStdString()
              .c_str()
          // std::format("SlopeCraftL internal error. Failed to find block image
          // "
          //             "for \"{}\". "
          //             "In the 3d structure, the corresponding block idx is "
          //             "{}.\nThe whole "
          //             "block palette is as below: {}",
          //             id, pblkid, blkid_full).c_str()
      );
      return false;
    }

    img_list_rmj.emplace_back(blkp->image);
  }

  auto block_at_callback =
      [this, &img_list_rmj](
          const int64_t r, const int64_t c) -> libFlatDiagram::block_img_ref_t {
    if (r < 0 or c < 0 or r >= this->schem.z_range() or
        c >= this->schem.x_range()) {  // out of range
      return libFlatDiagram::block_img_ref_t{img_list_rmj.at(0).data()};
    }

    const int ele = this->schem(c, 0, r);
    assert(ele >= 0 and
           ele < static_cast<ptrdiff_t>(this->schem.palette_size()));

    return libFlatDiagram::block_img_ref_t{img_list_rmj.at(ele).data()};
  };

  std::array<std::pair<std::string, std::string>, 4> txt{
    std::make_pair<std::string, std::string>(
        "Title", "Flat diagram generated by SlopeCraftL."),
    std::make_pair<std::string, std::string>("Software", "SlopeCraftL"),
    std::make_pair<std::string, std::string>(
        "Description",
        "This image is a flat diagram created by SlopeCraftL, which is is "
        "a subproject of SlopeCraft, developed by TokiNoBug."),
    std::make_pair<std::string, std::string>(
        "Comment",
        "SlopeCraft is a free software published "
        "under GPLv3 license. You can find "
        "its repository at https://github.com/SlopeCraft/SlopeCraft")};

  auto err = libFlatDiagram::export_flat_diagram(filename, fdopt,
                                                 block_at_callback, txt);
  if (not err.empty()) {
    option.ui.report_error(errorFlag::EXPORT_FLAT_DIAGRAM_FAILURE, err.c_str());
    return false;
  }
  return true;
}

namespace cereal {
template <class archive>
void save(archive& ar, const Eigen::ArrayXX<uint8_t>& mat) {
  ar(mat.rows(), mat.cols());
  ar(cereal::binary_data(mat.data(), mat.size()));
}

template <class archive>
void load(archive& ar, Eigen::ArrayXX<uint8_t>& mat) {
  Eigen::Index rows{0}, cols{0};
  ar(rows, cols);
  if (rows < 0 || cols < 0) {
    throw std::runtime_error{
      SCLTranslator::tr("序列化时遇到负尺寸：%1行%2列")
          .arg(rows)
          .arg(cols)
          .toStdString()
      // std::format("Found negative shape when deserializing "
      //             "Eigen::ArrayXX<uint8_t>, {} rows and {} cols",
      //             rows, cols)
    };
  }
  mat.resize(rows, cols);
  ar(cereal::binary_data(mat.data(), mat.size() * sizeof(uint8_t)));
}
}  // namespace cereal

std::string structure_3D_impl::save_cache(
    const std::filesystem::path& filename) const noexcept {
  try {
    std::filesystem::create_directories(filename.parent_path());
    boost::iostreams::filtering_ostream ofs{};
    ofs.set_auto_close(true);
    {
      boost::iostreams::zstd_params params;
      // ZSTD_defaultCLevel() doesn't exist below zstd 1.5
#if ZSTD_VERSION_MINOR >= 5
      params.level = static_cast<uint32_t>(ZSTD_defaultCLevel());
#else
      params.level = static_cast<uint32_t>(ZSTD_CLEVEL_DEFAULT);
#endif
      ofs.push(boost::iostreams::zstd_compressor{params});
      ofs.push(
          boost::iostreams::file_sink{filename.string(), std::ios::binary});
    }

    {
      cereal::BinaryOutputArchive boa{ofs};
      boa(*this);
    }

  } catch (const std::exception& e) {
    return SCLTranslator::tr("异常：%1").arg(e.what()).toStdString();
    // return std::format("Caught exception: {}", e.what());
  }

  return {};
}

std::expected<structure_3D_impl, std::string> structure_3D_impl::load_cache(
    const std::filesystem::path& filename) noexcept {
  structure_3D_impl ret;
  try {
    boost::iostreams::filtering_istream ifs;
    ifs.set_auto_close(true);
    ifs.push(boost::iostreams::zstd_decompressor{});
    ifs.push(
        boost::iostreams::file_source{filename.string(), std::ios::binary});
    {
      cereal::BinaryInputArchive bia{ifs};
      bia(ret);
    }
  } catch (const std::exception& e) {
    return std::unexpected(
        SCLTranslator::tr("异常：%1").arg(e.what()).toStdString());
  }

  return ret;
}

uint64_t structure_3D_impl::block_count() const noexcept {
  std::vector<uint8_t> LUT_is_air;
  LUT_is_air.reserve(this->schem.palette_size());
  for (auto& id : this->schem.palette()) {
    if (id == "air" || id == "minecraft:air") {
      LUT_is_air.emplace_back(1);
    } else {
      LUT_is_air.emplace_back(0);
    }
  }

  uint64_t counter = 0;
  for (int64_t i = 0; i < this->schem.size(); i++) {
    const auto cur_blk_id = this->schem(i);
    if (cur_blk_id >= LUT_is_air.size()) [[unlikely]] {
      counter++;
      continue;
    }
    if (!LUT_is_air[cur_blk_id]) {
      counter++;
    }
  }
  return counter;
}
