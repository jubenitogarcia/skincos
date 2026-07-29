let audioSources = [];
try { audioSources = $items('Video Has Audio?', 0) || []; } catch { audioSources = []; }
return $input.all().map((item, index) => {
  const response = item.json || {};
  const source = response.media_processing ? response : (audioSources[index]?.json || {});
  const transcript = String(response.text || response.transcript || '').trim();
  return { json: { ...source, media_processing: { ...(source.media_processing || {}), transcript, transcription_status: transcript ? 'completed' : (source.media_processing?.has_audio ? 'failed_non_blocking' : 'not_applicable') } } };
});
