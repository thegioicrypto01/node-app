import { app, autoUpdater } from 'electron'
import {
  IUpdateManager,
  ReleaseNote,
  UpdateReleaseNotesResponse,
  UpdateStatus,
} from 'Types/IUpdateManager'
import axios from 'axios'
import log from 'electron-log'

class UpdateManager implements IUpdateManager {
  private serverUrl = 'https://node-app-update-server.vercel.app'
  private url: string
  private status: UpdateStatus = {
    ignoreUpdates: false,
    hasUpdates: false,
    hasError: false,
    version: app.getVersion(),
  }

  initialize: () => Promise<void> = () => {
    this.url = `${this.serverUrl}/update/${
      process.platform
    }/${app.getVersion()}`

    if (app.isPackaged) {
      autoUpdater.setFeedURL({ url: this.url })

      autoUpdater.on(
        'update-downloaded',
        (e, releaseNotes, releaseName, releaseDate) => {
          this.status = {
            ...this.status,
            hasUpdates: true,
            update: {
              name: releaseName,
              notes: releaseNotes,
              date: releaseDate,
            },
          }
        }
      )

      autoUpdater.on('error', error => {
        log.error(error)
        this.status = {
          ...this.status,
          hasError: true,
          error: error.message,
        }
      })
    }

    return Promise.resolve()
  }

  checkUpdates: () => Promise<UpdateStatus> = () => {
    app.isPackaged && autoUpdater.checkForUpdates()
    if (!app.isPackaged) {
      this.status.hasUpdates = false //set to true to check how modal window looks
    }
    return Promise.resolve(this.status)
  }

  ignoreUpdates: () => Promise<UpdateStatus> = () => {
    this.status = {
      ...this.status,
      ignoreUpdates: true,
    }

    return this.checkUpdates()
  }

  resetError: () => Promise<UpdateStatus> = () => {
    this.status = {
      ...this.status,
      hasError: false,
      error: null,
    }
    return this.checkUpdates()
  }

  installUpdates: () => Promise<void> = () => {
    app.isPackaged && autoUpdater.quitAndInstall()
    if (!app.isPackaged) {
      this.status = {
        ...this.status,
        ignoreUpdates: true,
      }
    }
    return Promise.resolve()
  }

  notes: (
    after?: string,
    limit?: number
  ) => Promise<UpdateReleaseNotesResponse> = async (
    after: string,
    limit: number
  ) => {
    const res = await axios.get(`${this.serverUrl}/notes`, {
      params: { afterVersion: after, limit },
    })

    return res.data
  }

  note: (version: string) => Promise<ReleaseNote> = async version => {
    return (await axios.get(`${this.serverUrl}/notes/${version}`)).data
  }

  getNewVersions: () => Promise<string[]> = async () => {
    try {
      return (
        await axios.get(
          `${this.serverUrl}/notes?beforeVersion=v${this.status.version}&limit=100`
        )
      ).data.data.map((note: ReleaseNote) => note.version)
    } catch (error) {
      if (error.isAxiosError) {
        log.error(error?.code, '|', error?.config?.url, '|', error?.message)
      } else {
        log.error(error)
      }
      return []
    }
  }
}

const instance = new UpdateManager()

export default instance
