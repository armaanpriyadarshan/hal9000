---
license: apache-2.0
task_categories:
- text-to-speech
language:
- en
tags:
- piper
- tts
- hal 9000
---

# HAL 9000 Speech Dataset

This repository contains audio recordings of dialogue from HAL 9000, the AI character from 2001: A Space Odyssey. The full dataset contains most, but not all audio recordings of HAL 9000 from the film. The dataset is not cleaned, as background noise and variations in his voice are prevalent.  

The dataset can be formatted into the LJSpeech structure to ensure compatibility with most text-to-speech (TTS) models and training pipelines, such as [Piper](https://github.com/rhasspy/piper).

## Sources

- The audio recordings were collected from https://www.youtube.com/watch?v=9wrjl-H4Hs8.
- Transcriptions of the audio recordings were collected from https://hal9000computer.wordpress.com/2017/11/22/all-hal-9000-phrases-from-the-movie/

## Project

I used the cleaned version of the dataset to train my own HAL 9000 TTS model using [Piper](https://github.com/rhasspy/piper), based on their [john-en TTS model checkpoint](https://huggingface.co/datasets/rhasspy/piper-checkpoints/tree/main/en/en_US/john/medium). This was done by formatting the dataset to LJ Speech format. The final TTS model can be accessed in [this repository](https://huggingface.co/campwill/HAL-9000-Piper-TTS). I am currently using the TTS model for a HAL 9000 voice assistant project, which you can find on my [GitHub](https://github.com/campwill/hal-voice-assistant).
