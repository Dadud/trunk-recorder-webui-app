# Qwen3-ASR standalone container
# Build:  docker build -t qwen3-asr:0.1 -f qwen3.Dockerfile .
# Run:    docker run -d --name qwen3-asr --gpus all -p 8080:8080 \
#           -v /mnt/user/appdata/qwen3-asr/models-gguf:/work/models-gguf:ro \
#           qwen3-asr:0.1
#
# The image is self-contained: CUDA runtime + llama-server + the model files
# live inside. Host only needs to mount the GGUF model files read-only.
#
# This is the right way to run llama-server with CUDA on Unraid. Trying to
# run it as a host process means wrestling with host-vs-container glibc and
# manually finding CUDA libs in /var/lib/docker/btrfs/subvolumes.

FROM nvidia/cuda:12.9.0-runtime-ubuntu22.04
WORKDIR /work

# Build llama-server with CUDA + sm_61 (Pascal / 1080 Ti)
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git build-essential cmake libcurl4-openssl-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    git clone --depth 1 https://github.com/ggerganov/llama.cpp.git && \
    cd llama.cpp && \
    cmake -B build -DGGML_CUDA=ON -DCUDA_ARCHITECTURES=61 -DBUILD_SHARED_LIBS=OFF && \
    cmake --build build --config Release --target llama-server llama-mtmd-cli -j$(nproc) && \
    mkdir -p /work/models-gguf && \
    cp build/bin/llama-server build/bin/llama-mtmd-cli /work/

# Default to no model baked in; operator mounts GGUF dir from host
# at /work/models-gguf. Both files expected:
#   Qwen3-ASR-1.7B.Q4_K_M.gguf
#   mmproj-Qwen3-ASR-1.7B-Q8_0.gguf
ENV MODEL=/work/models-gguf/Qwen3-ASR-1.7B.Q4_K_M.gguf
ENV MMPROJ=/work/models-gguf/mmproj-Qwen3-ASR-1.7B-Q8_0.gguf
ENV PORT=8080

EXPOSE 8080

CMD ["/bin/sh", "-c", "exec /work/llama-server -m $MODEL --mmproj $MMPROJ -ngl 99 -c 4096 --port $PORT --host 0.0.0.0"]
