#include <emscripten.h>
#include <emscripten/heap.h>
#include <json.hpp>
#include <algorithm>
#include <array>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <unordered_map>
#include <vector>
#include <cstdlib>
#include "SlopeCraftL.h"
#include "converted_image.h"
#include "color_table.h"
#include "structure_3D.h"
#include "sc_parallel.hpp"

using json = nlohmann::json;
using namespace SlopeCraft;
EM_JS(void, sc_emit_progress, (const char* stage, double current, double total), {
  const address=Number(stage);
  if (!Number.isSafeInteger(address) || address<0) throw new Error('Invalid Memory64 progress string pointer');
  if (globalThis.scProgress) globalThis.scProgress({stage: UTF8ToString(address), current, total});
});
static_assert(sizeof(void*)==8 && sizeof(size_t)==8,"SlopeCraft Web must be built with true Memory64");

namespace {
template<class T> using owned = std::unique_ptr<T, SlopeCraft::deleter>;
struct block_record { mc_block_interface* block; uint8_t base; std::string list; };
struct task {
  owned<color_table> table;
  owned<converted_image> image;
  owned<structure_3D> structure;
  std::array<const mc_block_interface*, 64> selected{};
  json id;
  int version{21};
};
std::vector<owned<block_list_interface>> lists;
std::vector<block_record> blocks;
std::unordered_map<std::string, task> tasks;
std::vector<uint8_t> preview;
std::string response;
std::string native_error;
std::string current_stage;
int progress_current{}, progress_total{100};
unsigned export_serial{};
struct temporary_directory {
  std::filesystem::path path;
  bool keep{false};
  ~temporary_directory() {
    if(!keep) {std::error_code error;std::filesystem::remove_all(path,error);}
  }
};

void progress_range(void*, int low, int high, int value) {
  progress_current = value - low;
  progress_total = high - low;
  sc_emit_progress(current_stage.c_str(), progress_current, progress_total);
}
void progress_add(void*, int delta) {
  progress_current += delta;
  sc_emit_progress(current_stage.c_str(), progress_current, progress_total);
}
void report_error(void*, errorFlag, const char* message) { native_error = message ? message : "核心处理失败"; }
void working_status(void*, workStatus status) {
  if (static_cast<int>(status) != 0) sc_emit_progress(current_stage.c_str(), progress_current, progress_total);
}
ui_callbacks ui() { return {.cb_report_error=report_error, .cb_report_working_status=working_status}; }
progress_callbacks progress() { return {.cb_set_range=progress_range, .cb_add=progress_add}; }
void require(bool condition, const std::string& message) { if (!condition) throw std::runtime_error(message); }
void require_native(bool condition, const char* fallback) {
  require(condition, native_error.empty() ? fallback : native_error);
}
std::string task_key(const json& request) {
  require(request.contains("id"), "缺少任务 id");
  return request.at("id").dump();
}
task& get_task(const json& request) {
  auto found = tasks.find(task_key(request));
  require(found != tasks.end(), "此图片尚未转换，或任务已释放");
  return found->second;
}
int integer(const json& value, const char* name, int fallback) {
  if (!value.contains(name)) return fallback;
  const auto& item = value.at(name);
  if (item.is_number_integer()) return item.get<int>();
  if (item.is_boolean()) return item.get<bool>() ? 1 : 0;
  if (item.is_string()) return std::stoi(item.get<std::string>());
  throw std::runtime_error(std::string("无效数值参数：") + name);
}
int version_of(const json& options) {
  if (!options.contains("version")) return 21;
  const auto& v = options["version"];
  int version;
  if (v.is_number_integer()) version = v.get<int>();
  else {
    auto text = v.get<std::string>();
    if (text.starts_with("1.")) version = std::stoi(text.substr(2));
    else if (text == "26.1" || text == "26.1.2") version = 4790;
    else if (text == "26.2") version = 4903;
    else version = std::stoi(text);
  }
  require((version >= 12 && version <= 21) || version == 4790 || version == 4903 || version == 65535,
          "不支持的 Minecraft 版本");
  return version;
}
uint32_t background_of(const json& options) {
  if (!options.contains("backgroundColor")) return 0xffffffff;
  const auto& value = options["backgroundColor"];
  if (value.is_number()) return value.get<uint32_t>() | 0xff000000;
  auto text = value.get<std::string>();
  if (text.starts_with('#')) text.erase(0,1);
  return static_cast<uint32_t>(std::stoul(text, nullptr, 16)) | 0xff000000;
}
char character(const json& options, const char* key, char fallback) {
  if (!options.contains(key)) return fallback;
  const auto& value = options[key];
  if (value.is_number_integer()) return static_cast<char>(value.get<int>());
  const auto text = value.get<std::string>();
  require(!text.empty(), std::string("空参数：") + key);
  return text[0];
}
json block_json(size_t key) {
  const auto& rec = blocks.at(key);
  const auto* b = rec.block;
  return {{"key",key},{"id",b->getId()},{"idOld",b->getIdOld()},
    {"name",b->getNameZH()},{"nameZH",b->getNameZH()},{"nameEN",b->getNameEN()},
    {"baseColor",rec.base},{"version",static_cast<int>(b->getVersion())},
    {"imageFilename",b->getImageFilename()},{"icon",b->getImageFilename()},
    {"list",rec.list},{"needGlass",b->getNeedGlass()},{"doGlow",b->getDoGlow()},
    {"burnable",b->getBurnable()},{"endermanPickable",b->getEndermanPickable()},
    {"stackSize",b->getStackSize()}};
}
json catalog() {
  json result = json::array();
  for (size_t i=0; i<blocks.size(); ++i) result.push_back(block_json(i));
  return result;
}
json metadata() {
  const uint64_t heap_maximum=emscripten_get_heap_max();
  std::array<uint32_t,64> rgb;
  SCL_get_base_color_ARGB32(rgb.data());
  json colors = json::array();
  for (size_t i=0; i<rgb.size(); ++i) colors.push_back({{"baseColor",i},{"rgb",rgb[i]&0xffffff}});
  const auto map_colors=LUT_map_color_to_ARGB();
  return {{"version",SCL_getSCLVersion()},{"threads",sc_web::worker_count},
    {"lastWorkers",sc_web::last_workers.load()},{"pthread",true},{"simd",true},
    {"workersProcessed",sc_web::last_working_workers.load()},{"workerItems",sc_web::last_worker_items},
    {"memoryBudgetMB",sc_web::memory_budget_bytes/(1024*1024)},
    {"memory64",true},{"pointerBits",sizeof(void*)*8},{"addressBits",sizeof(void*)*8},
    {"memoryMaxBytes",heap_maximum},
    {"memoryMaxMiB",heap_maximum/(1024*1024)},
    {"memoryMinMiB",128},{"heapBytes",emscripten_get_heap_size()},
    {"baseColors",colors},{"mapColors",map_colors},{"versions",{12,13,14,15,16,17,18,19,20,21,4790,4903}},
    {"algorithms",{"r","R","H","X","l","L","A"}},
    {"formats",{"dat","litematic","nbt","schem","png","command","assembled-litematic","assembled-nbt"}},
    {"blocks",catalog()}};
}
json preview_of(task& t, bool compressed) {
  const size_t size = t.image->size();
  std::vector<uint32_t> argb(size);
  if (compressed && t.structure) t.image->get_compressed_image(*t.structure, argb.data());
  else t.image->get_converted_image(argb.data());
  preview.resize(size*4);
  for(size_t i=0; i<size; ++i) {
    preview[i*4] = argb[i] >> 16;
    preview[i*4+1] = argb[i] >> 8;
    preview[i*4+2] = argb[i];
    preview[i*4+3] = argb[i] >> 24;
  }
  return {{"pointer",std::to_string(reinterpret_cast<uintptr_t>(preview.data()))},{"length",preview.size()},
          {"width",t.image->cols()},{"height",t.image->rows()}};
}
json load_blocklist(const json& request, const uint8_t* bytes, size_t length) {
  require(bytes && length, "方块包内容为空");
  std::array<char,65536> error_buffer{}, warning_buffer{};
  string_deliver error{error_buffer.data(), error_buffer.size()-1};
  string_deliver warning{warning_buffer.data(), warning_buffer.size()-1};
  block_list_create_info info{.warnings=&warning,.error=&error};
  owned<block_list_interface> list{SCL_create_block_list_from_buffer(bytes,length,info)};
  require(bool(list),error.size ? std::string(error.data,error.size) : "无法读取方块包");
  const size_t size = list->size();
  std::vector<mc_block_interface*> pointers(size);
  std::vector<uint8_t> bases(size);
  require(list->get_blocks(pointers.data(),bases.data(),size)==size,"方块列表长度不一致");
  const std::string name = request.value("name", "custom");
  json loaded = json::array();
  for(size_t i=0; i<size; ++i) {
    blocks.push_back({pointers[i],bases[i],name});
    loaded.push_back(block_json(blocks.size()-1));
  }
  lists.push_back(std::move(list));
  return {{"blocks",loaded},{"warnings",std::string(warning.data,warning.size)}};
}
task create_palette(const json& request) {
  const json options = request.value("options",json::object());
  const int version=version_of(options);
  task t; t.version=version;
  color_table_create_info create{};
  create.mc_version=static_cast<SCL_gameVersion>(version);
  create.map_type=static_cast<SCL_mapTypes>(integer(options,"mapType",0));
  require(static_cast<int>(create.map_type)>=0 && static_cast<int>(create.map_type)<=2,"地图类型无效");
  create.ui=ui();
  // The catalog contains all supplied libraries. Default selection follows its
  // priority; explicit per-base choices from the UI replace it below.
  for(const auto& rec:blocks) if(!t.selected[rec.base] && static_cast<int>(rec.block->getVersion())<=version)
    t.selected[rec.base]=rec.block;
  std::array<int,64> explicitly_selected{};
  std::array<bool,64> allowed{};
  for(size_t i=0;i<64;++i) allowed[i]=t.selected[i]!=nullptr;
  if(request.contains("blocks")) for(const auto& choice:request["blocks"]) {
    int base=integer(choice,"baseColor",-1);
    const block_record* rec=nullptr;
    if(choice.contains("key")) {
      const int key=integer(choice,"key",-1);
      require(key>=0 && size_t(key)<blocks.size(),"选中的方块不存在");
      rec=&blocks[key]; base=rec->base;
    } else if(choice.contains("id")) {
      const auto id=choice.at("id").get<std::string>();
      for(const auto& b:blocks) if(id==b.block->getId() && (base<0 || base==b.base)) { rec=&b; base=b.base; break; }
    }
    require(base>=0 && base<64,"方块基色无效");
    const bool enabled=choice.value("enabled",true);
    if(enabled) {
      require(rec,"选中的方块未载入");
      require(static_cast<int>(rec->block->getVersion())<=version,"选中的方块在此 Minecraft 版本中不可用");
      t.selected[base]=rec->block; explicitly_selected[base]=1;allowed[base]=true;
    } else if(!explicitly_selected[base]) {
      // Disabling a map color must not discard its chosen physical block:
      // glass and stone remain necessary for water, bridges and support.
      if(rec&&static_cast<int>(rec->block->getVersion())<=version) t.selected[base]=rec->block;
      allowed[base]=false;
    }
  }
  for(size_t i=0;i<64;++i) { create.blocks[i]=t.selected[i]; create.basecolor_allow_LUT[i]=allowed[i]; }
  t.table.reset(SCL_create_color_table(create));
  require_native(bool(t.table),"无法创建调色板");
  return t;
}
json palette(const json& request) {
  auto t=create_palette(request);
  const auto colors=t.table->colors();
  const auto lut=LUT_map_color_to_ARGB();
  json entries=json::array();
  for(int i=0;i<colors.num_colors;++i) {
    const uint8_t map_id=colors.map_data[i];
    entries.push_back({{"mapId",map_id},{"rgb",lut[map_id]&0xffffff},
      {"baseColor",map_id/4},{"shade",map_id%4}});
  }
  return {{"colors",entries},{"colorCount",colors.num_colors},
    {"version",t.version},{"mapType",static_cast<int>(t.table->map_type())}};
}
json block_icon(const json& request) {
  const int key=integer(request,"key",-1);
  require(key>=0&&size_t(key)<blocks.size(),"方块图标不存在");
  std::array<uint32_t,256> pixels{};
  blocks[key].block->getImage(pixels.data());
  preview.resize(1024);
  for(size_t i=0;i<pixels.size();++i) {
    preview[i*4]=pixels[i]>>16;preview[i*4+1]=pixels[i]>>8;
    preview[i*4+2]=pixels[i];preview[i*4+3]=pixels[i]>>24;
  }
  return {{"key",key},{"preview",{{"pointer",std::to_string(reinterpret_cast<uintptr_t>(preview.data()))},
    {"length",preview.size()},{"width",16},{"height",16}}}};
}
json test_blocklist(const json& request) {
  auto t=create_palette(request);
  std::vector<const mc_block_interface*> pointers;
  std::vector<uint8_t> bases;
  auto add_key=[&](size_t key) {
    require(key<blocks.size(),"测试方块不存在");
    const auto& rec=blocks[key];
    if(static_cast<int>(rec.block->getVersion())<=t.version) {
      pointers.push_back(rec.block);bases.push_back(rec.base);
    }
  };
  if(request.contains("keys")) {
    for(const auto& value:request["keys"]) add_key(value.get<size_t>());
  } else {
    // The desktop tool tests every loaded block, grouped by base color,
    // independently of which single block represents that color in the palette.
    for(unsigned base=0;base<64;++base)
      for(size_t key=0;key<blocks.size();++key) if(blocks[key].base==base) add_key(key);
  }
  require(!pointers.empty(),"此版本中没有可测试的方块");
  const auto options=request.value("options",json::object());
  const auto format=request.value("format",options.value("format",std::string("litematic")));
  require(format=="nbt"||format=="litematic","测试方块列表支持 nbt 或 litematic");
  const auto dir=std::filesystem::path("/exports")/std::to_string(++export_serial);
  std::filesystem::create_directories(dir);
  temporary_directory cleanup{dir};
  const auto filename=std::string("test-blocklist.")+format;
  const auto path=dir/filename;
  std::array<char,65536> error_buffer{};
  string_deliver error{error_buffer.data(),error_buffer.size()-1};
  test_blocklist_options opt{.block_ptrs=pointers.data(),.basecolors=bases.data(),
    .block_count=pointers.size(),.err=&error};
  const bool generated=t.table->generate_test_schematic(path.c_str(),opt);
  require(generated,error.size?std::string(error.data,error.size):"测试方块列表导出失败");
  cleanup.keep=true;
  return {{"blockCount",pointers.size()},{"files",json::array({{{"name",filename},
    {"path",path.string()},{"mime","application/octet-stream"}}})}};
}
json convert(const json& request, const uint8_t* bytes, size_t length) {
  const int width = request.at("width"), height = request.at("height");
  require(width>0 && height>0 && width<=32768 && height<=32768,"图片尺寸无效");
  const uint64_t count = uint64_t(width)*height;
  require(count*4==length && bytes,"图片 RGBA 数据长度错误");
  require(count*128 < sc_web::memory_budget_bytes,"图片预计占用内存过大，请缩小图片或拆分任务");
  const json options=request.value("options",json::object());
  auto t=create_palette(request);
  t.id=request.at("id");
  std::vector<uint32_t> argb(count);
  for(size_t i=0;i<count;++i) argb[i]=(uint32_t(bytes[i*4+3])<<24)|(uint32_t(bytes[i*4])<<16)|(uint32_t(bytes[i*4+1])<<8)|bytes[i*4+2];
  const char pure=character(options,"pureTransparent",'B'),half=character(options,"halfTransparent",'C');
  require(pure=='B'||pure=='A',"全透明处理方式无效");
  require(half=='B'||half=='C'||half=='R',"半透明处理方式无效");
  SCL_preprocessImage(argb.data(),count,static_cast<SCL_PureTpPixelSt>(pure),static_cast<SCL_HalfTpPixelSt>(half),background_of(options));
  convert_option opt; opt.ui=ui(); opt.progress=progress();
  const char algorithm=character(options,"algorithm",'R');
  require(std::string("rRHXlLA").find(algorithm)!=std::string::npos,"颜色算法无效");
  require(algorithm!='A'||(width>=7&&height>=7),"遗传算法需要至少 7×7 的图片");
  opt.algo=static_cast<SCL_convertAlgo>(algorithm); opt.dither=options.value("dither",false);
  const auto ga=options.value("ga",json::object());
  opt.ai_cvter_opt.popSize=integer(ga,"popSize",integer(ga,"populationSize",50));
  opt.ai_cvter_opt.maxGeneration=integer(ga,"maxGeneration",integer(ga,"maxGenerations",200));
  opt.ai_cvter_opt.maxFailTimes=integer(ga,"maxFailTimes",50);
  opt.ai_cvter_opt.crossoverProb=ga.value("crossoverProb",0.8);
  opt.ai_cvter_opt.mutationProb=ga.value("mutationProb",0.01);
  require(opt.ai_cvter_opt.popSize>=4&&opt.ai_cvter_opt.popSize<=10000&&opt.ai_cvter_opt.maxGeneration>0&&opt.ai_cvter_opt.maxGeneration<=100000,"遗传算法参数超出范围");
  require(opt.ai_cvter_opt.crossoverProb>=0&&opt.ai_cvter_opt.crossoverProb<=1&&opt.ai_cvter_opt.mutationProb>=0&&opt.ai_cvter_opt.mutationProb<=1,"遗传算法概率应在 0 到 1 之间");
  t.image.reset(t.table->convert_image({argb.data(),size_t(height),size_t(width)},opt));
  require_native(bool(t.image),"图片转换失败");
  const auto colors=t.table->colors();
  const auto data_preview=preview_of(t,false);
  const auto id=t.id;
  tasks.insert_or_assign(task_key(request),std::move(t));
  return {{"id",id},{"width",width},{"height",height},{"preview",data_preview},
    {"colors",colors.num_colors},{"stats",{{"colors",colors.num_colors},{"threads",sc_web::worker_count},
      {"workersUsed",sc_web::last_workers.load()},{"workersProcessed",sc_web::last_working_workers.load()},
      {"workerItems",sc_web::last_worker_items}}}};
}
json build(const json& request) {
  auto& t=get_task(request);
  require(bool(t.image),"图片位于浏览器缓存，请先恢复");
  require(t.table->is_vanilla(),"仅数据文件模式不生成实体结构，请选择平面或立体地图画");
  const auto options=request.value("options",json::object());
  build_options opt; opt.ui=ui();opt.main_progressbar=progress();opt.sub_progressbar=progress();
  const int max_height=integer(options,"maxHeight",256),interval=integer(options,"bridgeInterval",3);
  require(max_height>=14&&max_height<=65535&&interval>=0&&interval<=65535,"高度或桥接间隔超出范围");
  opt.max_allowed_height=max_height; opt.bridge_interval=interval;
  opt.compress_method=static_cast<SCL_compressSettings>(integer(options,"compression",0));
  opt.glass_method=static_cast<SCL_glassBridgeSettings>(integer(options,"glassBridge",0));
  opt.support_block_settings=static_cast<SCL_supportBlockSettings>(integer(options,"supportBlock",0));
  require(int(opt.compress_method)>=0&&int(opt.compress_method)<=3&&int(opt.glass_method)>=0&&int(opt.glass_method)<=1&&int(opt.support_block_settings)>=0&&int(opt.support_block_settings)<=2,"构建选项无效");
  opt.fire_proof=options.value("fireproof",false);opt.enderman_proof=options.value("enderproof",false);
  opt.connect_mushrooms=options.value("connectMushroom",false);
  // Release a previous 3D tensor before allocating the replacement.
  t.structure.reset();
  t.structure.reset(t.table->build(*t.image,opt));
  require_native(bool(t.structure),"构建失败");
  std::array<size_t,64> counts{};
  t.table->stat_blocks(*t.structure,counts.data());
  json materials=json::array();
  for(size_t i=0;i<64;++i) if(counts[i]) {
    const auto* block=t.selected[i];
    materials.push_back({{"baseColor",i},{"id",block ? block->idForVersion(static_cast<SCL_gameVersion>(t.version)) : "minecraft:air"},
      {"name",block?block->getNameZH():"空气"},{"nameEN",block?block->getNameEN():"Air"},{"count",counts[i]},
      {"stackSize",block?block->getStackSize():64}});
  }
  return {{"id",t.id},{"size",{t.structure->shape_x(),t.structure->shape_y(),t.structure->shape_z()}},
          {"blockCount",t.structure->block_count()},{"materials",materials},{"preview",preview_of(t,true)}};
}
json cache_save(const json& request) {
  auto& t=get_task(request);
  require(bool(t.image),"图片已释放，请先恢复缓存");
  const auto dir=std::filesystem::path("/cache")/std::to_string(++export_serial);
  std::filesystem::create_directories(dir);
  temporary_directory cleanup{dir};
  const auto image_path=dir/"image.bin";
  const auto& image=dynamic_cast<const converted_image_impl&>(*t.image);
  const auto image_error=image.save_cache(image_path);
  require(image_error.empty(),image_error);
  json files=json::array({{{"kind","image"},{"path",image_path.string()},{"name","image.bin"}}});
  if(t.structure) {
    const auto structure_path=dir/"structure.zst";
    const auto& structure=dynamic_cast<const structure_3D_impl&>(*t.structure);
    const auto structure_error=structure.save_cache(structure_path);
    require(structure_error.empty(),structure_error);
    files.push_back({{"kind","structure"},{"path",structure_path.string()},{"name","structure.zst"}});
  }
  cleanup.keep=true;
  return {{"files",files},{"hasStructure",bool(t.structure)}};
}
json cache_load(const json& request) {
  auto& t=get_task(request);
  const auto image_path=request.at("imagePath").get<std::string>();
  auto image=converted_image_impl::load_cache(dynamic_cast<const color_table_impl&>(*t.table),image_path);
  require(bool(image),image ? "" : image.error());
  owned<structure_3D> structure;
  if(request.contains("structurePath")&&!request["structurePath"].is_null()) {
    auto loaded=structure_3D_impl::load_cache(request.at("structurePath").get<std::string>());
    require(bool(loaded),loaded ? "" : loaded.error());
    structure.reset(new structure_3D_impl{std::move(loaded.value())});
  }
  t.structure=std::move(structure);
  t.image.reset(new converted_image_impl{std::move(image.value())});
  return {{"id",t.id},{"width",t.image->cols()},{"height",t.image->rows()},
          {"hasStructure",bool(t.structure)},{"preview",preview_of(t,bool(t.structure))}};
}
json export_files(const json& request) {
  auto& t=get_task(request);
  require(bool(t.image),"图片位于浏览器缓存，请先恢复");
  const auto options=request.value("options",json::object());
  const auto format=request.at("format").get<std::string>();
  const auto dir=std::filesystem::path("/exports")/std::to_string(++export_serial);
  std::filesystem::create_directories(dir);
  temporary_directory cleanup{dir};
  const auto name=options.value("name",std::string("SlopeCraft"));
  auto safe_name=name;
  for(auto& c:safe_name) if(c=='/'||c=='\\'||c<32||c==':') c='_';
  if(safe_name.empty()) safe_name="SlopeCraft";
  const int begin_index=integer(options,"beginIndex",0);
  require(begin_index>=0,"地图编号不可为负数");
  litematic_options lite; const auto region_name=options.value("regionName",std::string("SlopeCraft"));
  lite.litename_utf8=name.c_str();lite.region_name_utf8=region_name.c_str();lite.ui=ui();lite.progressbar=progress();
  vanilla_structure_options vanilla; vanilla.is_air_structure_void=options.value("isAirStructureVoid",true);vanilla.ui=ui();vanilla.progressbar=progress();
  assembled_maps_options assembly;assembly.mc_version=static_cast<SCL_gameVersion>(t.version);
  assembly.begin_index=begin_index;assembly.after_1_20_5=options.value("after1205",t.version>=20);
  assembly.frame_variant=static_cast<SCL_item_frame_variant>(integer(options,"frameVariant",0));
  assembly.map_facing=static_cast<SCL_map_facing>(integer(options,"mapFacing",integer(options,"facing",0)));
  require(int(assembly.map_facing)>=0&&int(assembly.map_facing)<=11&&int(assembly.frame_variant)>=0&&int(assembly.frame_variant)<=1,"物品展示框选项无效");
  assembly.fixed_frame=options.value("fixedFrame",true);assembly.invisible_frame=options.value("invisibleFrame",true);
  if(format=="dat") {
    map_data_file_options opt;opt.folder_path=dir.c_str();opt.begin_index=begin_index;opt.ui=ui();opt.progress=progress();
    require_native(t.image->export_map_data(opt),"地图数据导出失败");
  } else if(format=="command") {
    std::ostringstream output;
    ostream_wrapper wrapper;
    wrapper.handle=&output;wrapper.callback_write_data=[](const void* data,size_t length,void* handle){static_cast<std::ostream*>(handle)->write(static_cast<const char*>(data),length);};
    map_data_file_give_command_options opt;opt.destination=&wrapper;opt.begin_index=begin_index;
    opt.after_1_12=t.version>=13;opt.after_1_20_5=assembly.after_1_20_5;
    opt.set_name_as_index=options.value("setNameAsIndex",true);
    const int stack_count=integer(options,"stackCount",1);
    require(stack_count>0&&stack_count<=64,"地图命令堆叠数应为 1 到 64");
    opt.stack_count=stack_count;
    require_native(t.image->get_map_command(opt),"地图命令导出失败");
    std::ofstream file{dir/(safe_name+".mcfunction")};file<<output.str();
  } else if(format=="assembled-litematic") {
    require_native(t.image->export_assembled_maps_litematic((dir/(safe_name+"-maps.litematic")).c_str(),assembly,lite),"展示框结构导出失败");
  } else if(format=="assembled-nbt") {
    require_native(t.image->export_assembled_maps_vanilla_structure((dir/(safe_name+"-maps.nbt")).c_str(),assembly,vanilla),"展示框结构导出失败");
  } else {
    require(bool(t.structure),"请先构建实体结构再导出此格式");
    if(format=="litematic") require_native(t.structure->export_litematica((dir/(safe_name+".litematic")).c_str(),lite),"投影导出失败");
    else if(format=="nbt") require_native(t.structure->export_vanilla_structure((dir/(safe_name+".nbt")).c_str(),vanilla),"原版结构导出失败");
    else if(format=="schem") {
      WE_schem_options opt;opt.ui=ui();opt.progressbar=progress();
      for(int i=0;i<3;++i) {
        if(options.contains("offset")) opt.offset[i]=options["offset"].at(i);
        if(options.contains("weOffset")) opt.we_offset[i]=options["weOffset"].at(i);
      }
      std::vector<std::string> mods=options.value("requiredMods",std::vector<std::string>{});
      std::vector<const char*> mod_ptrs;for(const auto& mod:mods)mod_ptrs.push_back(mod.c_str());
      opt.required_mods_name_utf8=mod_ptrs.data();opt.num_required_mods=mod_ptrs.size();
      require_native(t.structure->export_WE_schem((dir/(safe_name+".schem")).c_str(),opt),"WorldEdit 结构导出失败");
    } else if(format=="png") {
      flag_diagram_options opt;opt.ui=ui();opt.progressbar=progress();
      opt.split_line_row_margin=integer(options,"splitLineRowMargin",16);opt.split_line_col_margin=integer(options,"splitLineColMargin",16);
      opt.png_compress_level=integer(options,"pngCompression",9);
      require(opt.png_compress_level>=0&&opt.png_compress_level<=9,"PNG 压缩等级应为 0 到 9");
      require_native(t.structure->export_flat_diagram((dir/(safe_name+"-diagram.png")).c_str(),*t.table,opt),"平面图导出失败（仅平面模式支持）");
    } else throw std::runtime_error("不支持的导出格式");
  }
  json files=json::array();
  for(const auto& file:std::filesystem::directory_iterator(dir)) if(file.is_regular_file()) {
    const auto extension=file.path().extension().string();
    files.push_back({{"name",file.path().filename().string()},{"path",file.path().string()},
      {"mime",extension==".png"?"image/png":extension==".mcfunction"?"text/plain;charset=utf-8":"application/octet-stream"}});
  }
  std::sort(files.begin(),files.end(),[](const json& a,const json& b){return a["name"].get<std::string>()<b["name"].get<std::string>();});
  cleanup.keep=true;
  return {{"files",files}};
}
}

extern "C" EMSCRIPTEN_KEEPALIVE const char* sc_request(const char* request_json,const uint8_t* bytes,size_t length) {
  try {
    require(request_json,"请求为空");
    const auto request=json::parse(request_json);
    const auto op=request.at("op").get<std::string>();
    current_stage=op;native_error.clear();progress_current=0;progress_total=100;
    sc_emit_progress(op.c_str(),0,100);
    json result;
    if(op=="init") {
      sc_web::worker_count=std::clamp(integer(request,"threads",4),2,8);
      const int max_budget_mib=static_cast<int>(emscripten_get_heap_max()/(1024*1024));
      const int budget=std::clamp(integer(request,"memoryBudgetMB",1536),128,max_budget_mib);
      sc_web::memory_budget_bytes=uint64_t(budget)*1024*1024;
      result=metadata();
    } else if(op=="metadata") result=metadata();
    else if(op=="loadBlocklist") result=load_blocklist(request,bytes,length);
    else if(op=="blockIcon") result=block_icon(request);
    else if(op=="palette") result=palette(request);
    else if(op=="testBlocklist") result=test_blocklist(request);
    else if(op=="convert") result=convert(request,bytes,length);
    else if(op=="build") result=build(request);
    else if(op=="export") result=export_files(request);
    else if(op=="cacheSave") result=cache_save(request);
    else if(op=="cacheLoad") result=cache_load(request);
    else if(op=="cacheRelease") {
      auto& t=get_task(request);t.structure.reset();t.image.reset();
      preview.clear();preview.shrink_to_fit();result={{"released",true}};
    } else if(op=="releaseStructure") {
      get_task(request).structure.reset();result={{"released",true}};
    }
    else if(op=="clear"||op=="dispose") {
      if(request.contains("id")) tasks.erase(task_key(request));else tasks.clear();
      preview.clear();preview.shrink_to_fit();result={{"cleared",true}};
    } else throw std::runtime_error("未知核心操作："+op);
    response=json({{"ok",true},{"data",result}}).dump();
    sc_emit_progress(op.c_str(),100,100);
  } catch(const std::exception& error) {
    response=json({{"ok",false},{"error",error.what()}}).dump();
  } catch(...) {
    response=json({{"ok",false},{"error","未知核心异常"}}).dump();
  }
  return response.c_str();
}

// These wrappers deliberately retain native i64 signatures. Emscripten wraps
// standard malloc/free into Number-based compatibility helpers; the bridge uses
// these exports to keep pointers and size_t as BigInt across the actual ABI.
extern "C" EMSCRIPTEN_KEEPALIVE void* sc_allocate(size_t bytes) { return std::malloc(bytes); }
extern "C" EMSCRIPTEN_KEEPALIVE void sc_deallocate(void* pointer) { std::free(pointer); }
