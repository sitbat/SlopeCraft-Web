cmake_minimum_required(VERSION 3.29)
# The toolchain determines pointer/size_t widths during project(), so Memory64
# must already be present in both language flags at that point.
foreach(language C CXX)
  if(NOT CMAKE_${language}_FLAGS MATCHES "MEMORY64")
    set(CMAKE_${language}_FLAGS "${CMAKE_${language}_FLAGS} -sMEMORY64=1" CACHE STRING "Memory64 compiler flags" FORCE)
  endif()
endforeach()
project(SlopeCraftWeb VERSION 5.4.1 LANGUAGES C CXX)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Configure with the Emscripten toolchain: emcmake cmake -S web -B work/build-web")
endif()
if(NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "SlopeCraft Web requires true Memory64 (8-byte pointers). Use a fresh build directory.")
endif()
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_SCAN_FOR_MODULES OFF)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(CMAKE_BUILD_TYPE Release CACHE STRING "")
set(SC_ROOT "${CMAKE_CURRENT_LIST_DIR}/..")
set(SC_WASM_OUTPUT "${CMAKE_CURRENT_LIST_DIR}/wasm" CACHE PATH "Static website engine output")
set(SC_PTHREAD_POOL_SIZE 8 CACHE STRING "Number of prewarmed browser pthread workers")
set(SC_MAXIMUM_MEMORY_BYTES 17179869184 CACHE STRING "Memory64 shared linear-memory maximum, bytes")
if(SC_MAXIMUM_MEMORY_BYTES GREATER 17179869184 OR SC_MAXIMUM_MEMORY_BYTES LESS 134217728)
  message(FATAL_ERROR "The verified Memory64 runtime maximum is 16 GiB; initial memory is 128 MiB.")
endif()
add_compile_options(-pthread -msimd128 -fexceptions)
add_link_options(-pthread -msimd128 -fexceptions)
include(FetchContent)
if(EXISTS "${CMAKE_CURRENT_LIST_DIR}/dependency-lock.json")
  file(READ "${CMAKE_CURRENT_LIST_DIR}/dependency-lock.json" sc_dependency_lock)
endif()
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()
function(sc_fetch name url)
  set(hash_option)
  if(sc_dependency_lock)
    string(JSON archive_hash GET "${sc_dependency_lock}" dependencies ${name} sha256)
    set(hash_option URL_HASH "SHA256=${archive_hash}")
  endif()
  FetchContent_Declare(${name} URL "${url}" ${hash_option} DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
  FetchContent_GetProperties(${name})
  if(NOT ${name}_POPULATED)
    FetchContent_Populate(${name})
  endif()
  set(${name}_SOURCE_DIR "${${name}_SOURCE_DIR}" PARENT_SCOPE)
endfunction()

# All dependencies are pinned. They are build-time downloads, never CDN runtime
# requests. Qt, platform deployment tools and native OpenMP are not required.
sc_fetch(eigen https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz)
sc_fetch(heu https://github.com/SlopeCraft/HeuristicFlow/archive/refs/tags/v1.6.5.2.tar.gz)
sc_fetch(xsimd https://github.com/xtensor-stack/xsimd/archive/refs/tags/13.2.0.tar.gz)
sc_fetch(cereal https://github.com/USCiLab/cereal/archive/refs/tags/v1.3.2.tar.gz)
sc_fetch(json https://github.com/nlohmann/json/archive/refs/tags/v3.11.3.tar.gz)
sc_fetch(magic_enum https://github.com/Neargye/magic_enum/archive/refs/tags/v0.9.7.tar.gz)
sc_fetch(boost https://archives.boost.io/release/1.86.0/source/boost_1_86_0.tar.gz)
sc_fetch(zlib https://github.com/madler/zlib/archive/refs/tags/v1.3.1.tar.gz)
sc_fetch(png https://github.com/pnggroup/libpng/archive/refs/tags/v1.6.50.tar.gz)
sc_fetch(zstd https://github.com/facebook/zstd/archive/refs/tags/v1.5.7.tar.gz)
sc_fetch(libzip https://libzip.org/download/libzip-1.11.4.tar.xz)
sc_fetch(nbt https://github.com/PrismLauncher/libnbtplusplus/archive/23b955121b8217c1c348a9ed2483167a6f3ff4ad.tar.gz)

set(zlib_sources adler32.c compress.c crc32.c deflate.c gzclose.c gzlib.c gzread.c gzwrite.c infback.c inffast.c inflate.c inftrees.c trees.c uncompr.c zutil.c)
list(TRANSFORM zlib_sources PREPEND "${zlib_SOURCE_DIR}/")
add_library(sc_zlib STATIC ${zlib_sources})
target_compile_definitions(sc_zlib PRIVATE Z_HAVE_UNISTD_H)
target_include_directories(sc_zlib PUBLIC "${zlib_SOURCE_DIR}")
add_library(ZLIB::ZLIB ALIAS sc_zlib)
set(ZLIB_LIBRARY sc_zlib CACHE STRING "" FORCE)
set(ZLIB_INCLUDE_DIR "${zlib_SOURCE_DIR}" CACHE PATH "" FORCE)
set(ZLIB_INCLUDE_DIRS "${zlib_SOURCE_DIR}")
set(ZLIB_LIBRARIES sc_zlib)
set(ZLIB_FOUND TRUE)

configure_file("${png_SOURCE_DIR}/scripts/pnglibconf.h.prebuilt" "${CMAKE_BINARY_DIR}/generated/pnglibconf.h" COPYONLY)
set(png_sources png.c pngerror.c pngget.c pngmem.c pngpread.c pngread.c pngrio.c pngrtran.c pngrutil.c pngset.c pngtrans.c pngwio.c pngwrite.c pngwtran.c pngwutil.c)
list(TRANSFORM png_sources PREPEND "${png_SOURCE_DIR}/")
add_library(sc_png STATIC ${png_sources})
target_include_directories(sc_png PUBLIC "${png_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/generated")
target_link_libraries(sc_png PUBLIC sc_zlib)

file(GLOB zstd_sources "${zstd_SOURCE_DIR}/lib/common/*.c" "${zstd_SOURCE_DIR}/lib/compress/*.c" "${zstd_SOURCE_DIR}/lib/decompress/*.c")
add_library(sc_zstd STATIC ${zstd_sources})
target_include_directories(sc_zstd PUBLIC "${zstd_SOURCE_DIR}/lib")
target_compile_definitions(sc_zstd PRIVATE ZSTD_DISABLE_ASM)

foreach(option BUILD_TOOLS BUILD_REGRESS BUILD_EXAMPLES BUILD_DOC BUILD_SHARED_LIBS LIBZIP_DO_INSTALL ENABLE_COMMONCRYPTO ENABLE_GNUTLS ENABLE_MBEDTLS ENABLE_OPENSSL ENABLE_WINDOWS_CRYPTO ENABLE_BZIP2 ENABLE_LZMA ENABLE_ZSTD)
  set(${option} OFF CACHE BOOL "" FORCE)
endforeach()
add_subdirectory("${libzip_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/libzip" EXCLUDE_FROM_ALL)
set(NBT_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(NBT_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory("${nbt_SOURCE_DIR}" "${CMAKE_BINARY_DIR}/nbt" EXCLUDE_FROM_ALL)
target_link_libraries(nbt++ sc_zlib)

set(SlopeCraft_GPU_API None)
set(SlopeCraft_vectorize true)
set(SlopeCraft_gprof false)
configure_file("${SC_ROOT}/utilities/SC_version_buildtime.h.in" "${CMAKE_BINARY_DIR}/generated/SC_version_buildtime.h" @ONLY)
file(WRITE "${CMAKE_BINARY_DIR}/generated/SlopeCraftL_export.h" "#pragma once\n#define SCL_EXPORT\n")
file(READ "${SC_ROOT}/utilities/SC_GlobalEnums.h" enums_source)
string(REGEX MATCH "enum class MCDataVersion_t : int \\{[^}]*\\}" data_enum "${enums_source}")
string(REGEX MATCHALL "[A-Za-z0-9_]+ = [0-9]+" data_enumerators "${data_enum}")
set(data_version_table "#pragma once\n#include <array>\n#include <string_view>\n#include <utility>\nnamespace sc_web {\ninline constexpr auto data_versions=std::to_array<std::pair<MCDataVersion::MCDataVersion_t,std::string_view>>({\n")
foreach(enumerator IN LISTS data_enumerators)
  string(REGEX REPLACE " = [0-9]+" "" enumerator_name "${enumerator}")
  string(APPEND data_version_table "{MCDataVersion::MCDataVersion_t::${enumerator_name},\"${enumerator_name}\"},\n")
endforeach()
string(APPEND data_version_table "});\n}\n")
file(WRITE "${CMAKE_BINARY_DIR}/generated/sc_data_versions.hpp" "${data_version_table}")

file(GLOB scl_sources "${SC_ROOT}/SlopeCraftL/*.cpp")
set(core_sources
  native/sc_core.cpp
  ${scl_sources}
  "${SC_ROOT}/utilities/ColorManip/CIEDE00.cpp"
  "${SC_ROOT}/utilities/ColorManip/ColorCvt.cpp"
  "${SC_ROOT}/utilities/ColorManip/ColorDiff.cpp"
  "${SC_ROOT}/utilities/ColorManip/hash.cpp"
  "${SC_ROOT}/utilities/ExternalConverters/GAConverter/GAConverter.cpp"
  "${SC_ROOT}/utilities/ExternalConverters/GAConverter/sortColor.cpp"
  "${SC_ROOT}/utilities/MapImageCvter/MapImageCvter.cpp"
  "${SC_ROOT}/utilities/MCDataVersion/MCDataVersion.cpp"
  "${SC_ROOT}/utilities/ProcessBlockId/process_block_id.cpp"
  "${SC_ROOT}/utilities/NBTWriter/NBTWriter.cpp"
  "${SC_ROOT}/utilities/Schem/Schem.cpp"
  "${SC_ROOT}/utilities/Schem/bit_shrink.cpp"
  "${SC_ROOT}/utilities/Schem/mushroom.cpp"
  "${SC_ROOT}/utilities/Schem/entity.cpp"
  "${SC_ROOT}/utilities/Schem/item.cpp"
  "${SC_ROOT}/utilities/FlatDiagram/FlatDiagram.cpp"
  "${SC_ROOT}/utilities/libpngReader/libpng_reader.cpp"
  "${SC_ROOT}/utilities/sNBT_formatter/sNBT_formatter.cpp"
  "${SC_ROOT}/utilities/GPUWrapper/None/GPU_interface.cpp"
  "${boost_SOURCE_DIR}/libs/iostreams/src/zstd.cpp"
)
add_executable(slopecraft ${core_sources})
target_include_directories(slopecraft PRIVATE
  native "${SC_ROOT}" "${SC_ROOT}/SlopeCraftL" "${SC_ROOT}/utilities"
  "${SC_ROOT}/utilities/ColorManip" "${SC_ROOT}/utilities/GPUWrapper"
  "${SC_ROOT}/utilities/FlatDiagram" "${SC_ROOT}/utilities/libpngReader"
  "${SC_ROOT}/utilities/ProcessBlockId" "${SC_ROOT}/utilities/MCDataVersion"
  "${SC_ROOT}/utilities/version_set" "${SC_ROOT}/utilities/sNBT_formatter"
  "${CMAKE_BINARY_DIR}/generated"
  "${eigen_SOURCE_DIR}" "${heu_SOURCE_DIR}" "${xsimd_SOURCE_DIR}/include"
  "${cereal_SOURCE_DIR}/include" "${json_SOURCE_DIR}/single_include/nlohmann"
  "${magic_enum_SOURCE_DIR}/include" "${boost_SOURCE_DIR}" "${nbt_SOURCE_DIR}/include"
)
target_compile_definitions(slopecraft PRIVATE SLOPECRAFT_WEB SLOPECRAFTL_NOT_INSTALLED SCL_FIND_GlobalEnums_BY_PATH _USE_MATH_DEFINES BOOST_IOSTREAMS_NO_LIB BOOST_IOSTREAMS_STATIC_LINK EIGEN_DEFAULT_DENSE_INDEX_TYPE=int64_t SC_WASM_MAXIMUM_MEMORY_BYTES=${SC_MAXIMUM_MEMORY_BYTES}ULL)
target_link_libraries(slopecraft PRIVATE sc_png sc_zlib sc_zstd zip nbt++)
target_compile_options(slopecraft PRIVATE -O3)
target_link_options(slopecraft PRIVATE -O3 --no-entry
  "-sMEMORY64=1"
  "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sEXPORT_NAME=createSlopeCraft"
  "-sENVIRONMENT=web,worker,node" "-sPTHREAD_POOL_SIZE=${SC_PTHREAD_POOL_SIZE}"
  "-sPTHREAD_POOL_SIZE_STRICT=2" "-sALLOW_MEMORY_GROWTH=1"
  "-sINITIAL_MEMORY=134217728" "-sMAXIMUM_MEMORY=${SC_MAXIMUM_MEMORY_BYTES}"
  "-sSTACK_SIZE=4194304" "-sDEFAULT_PTHREAD_STACK_SIZE=2097152"
  "-sFORCE_FILESYSTEM=1" "-sFILESYSTEM=1"
  "-sEXPORTED_FUNCTIONS=['_sc_request','_sc_allocate','_sc_deallocate','_malloc','_free']"
  "-sEXPORTED_RUNTIME_METHODS=['FS','ccall','cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','HEAPU8','wasmMemory','PThread']"
)
set_target_properties(slopecraft PROPERTIES SUFFIX ".js" RUNTIME_OUTPUT_DIRECTORY "${SC_WASM_OUTPUT}")
