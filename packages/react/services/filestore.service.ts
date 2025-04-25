import type { AxiosInterceptor } from '../types/api.type';

type UploadFileProps = {
  file: File;
  scope: string;
  directory: string;
  name: string;
  disableLoading?: boolean;
  onProgress?: (progress: number) => void;
};

type Options = {
  apiBaseUrl?: string;
};

const initFilestoreService = (axios: AxiosInterceptor) => {
  let options: Options = {};
  const { apiBaseUrl = '/api/file' } = options;

  const uploadFile = async ({
    file,
    scope,
    directory,
    name,
    disableLoading,
    onProgress,
  }: UploadFileProps) => {
    const { data } = await axios.get(`${apiBaseUrl}/upload`, {
      requestKey: `filestore/presign/file/${name}`,
      isInterruptive: !disableLoading,
      feedback: {
        loading: 'Preparing upload',
      },
      params: {
        scope,
        directory,
        filename: name,
        fileType: file.type,
      },
    });

    return axios.put(data.url, file, {
      requestKey: `filestore/upload/${name}`,
      isInterruptive: !disableLoading,
      feedback: {
        loading: 'Uploading file',
      },
      headers: {
        'Content-Type': file.type,
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round(
            (progressEvent.loaded / progressEvent.total) * 100,
          );
          onProgress(progress);
        }
      },
    });
  };

  const deleteFiles = async (keys: string[]) => {
    const { data } = await axios.post(
      '/file/delete',
      {
        keys,
      },
      {
        requestKey: 'filestore/delete',
      },
    );

    return data;
  };

  const uploadVideo = async ({
    file,
    scope,
    directory,
    name,
  }: UploadFileProps) => {
    const { data: presign } = await axios.get(`${apiBaseUrl}/upload`, {
      requestKey: `filestore/presign/video/${name}`,
      isInterruptive: true,
      feedback: {
        loading: 'Preparing upload',
      },
      params: {
        scope,
        directory,
        filename: name,
      },
    });

    await axios.put(presign.url, file, {
      requestKey: `filestore/upload/video/${name}`,
      isInterruptive: true,
      feedback: {
        loading: 'Uploading video',
      },
      headers: {
        'Content-Type': file.type,
      },
    });

    const { data } = await axios.post(
      `${apiBaseUrl}/video/convert`,
      {
        scope,
        directory,
        filename: name,
      },
      {
        requestKey: 'filestore/convert/video',
        isInterruptive: true,
        feedback: {
          loading: 'Triggering video conversion',
        },
      },
    );

    return data;
  };

  const uploadAudio = async ({
    file,
    scope,
    directory,
    name,
  }: UploadFileProps) => {
    const { data: presign } = await axios.get(`${apiBaseUrl}/upload`, {
      requestKey: `filestore/presign/audio/${name}`,
      isInterruptive: true,
      feedback: {
        loading: 'Preparing upload',
      },
      params: {
        scope,
        directory,
        filename: name,
      },
    });

    await axios.put(presign.url, file, {
      requestKey: `filestore/upload/audio/${name}`,
      isInterruptive: true,
      feedback: {
        loading: 'Uploading audio',
      },
      headers: {
        'Content-Type': file.type,
      },
    });

    const { data } = await axios.post(
      `${apiBaseUrl}/audio/convert`,
      {
        scope,
        directory,
        filename: name,
      },
      {
        requestKey: 'filestore/convert/audio',
        isInterruptive: true,
        feedback: {
          loading: 'Triggering audio conversion',
        },
      },
    );

    return data;
  };

  const getJobStatus = async (id: string) => {
    const { data } = await axios.get(`${apiBaseUrl}/job/${id}`, {
      requestKey: `filestore/get-job/${id}`,
    });

    return data;
  };

  const setOptions = (opts: Options) => {
    options = {
      ...options,
      ...opts,
    };
  };

  return {
    uploadFile,
    deleteFiles,
    uploadVideo,
    uploadAudio,
    getJobStatus,
    setOptions,
  };
};

export default initFilestoreService;
