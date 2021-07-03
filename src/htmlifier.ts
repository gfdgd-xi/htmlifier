import JSZip from '../lib/jszip.ts'
import { ProjectSource, getProject } from './get-project.ts'
import getDataUrl from './get-data-url.ts'
import getFileExtension from './get-file-extension.ts'
import { escapeCss, escapeHtml } from './escape.ts'

/** A CSS colour */
type Colour = string

export type Logger = (
  message: string,
  type: 'status' | 'progress' | 'error'
) => void

/** Options for HTMLification */
type HtmlifyOptions = {
  /** Logging function to track the progress of HTMLification */
  log: Logger

  /**
   * Whether to store the project.json, assets, and VM separately and bundle
   * them all up in a .zip file.
   */
  zip: boolean

  /** Whether to include the VM inside the HTML file */
  includeVm: boolean

  /** The page title of the resulting HTML file */
  title: string

  /**
   * The value of the username block; this can also be changed by setting `☁
   * username` with special cloud behaviours enabled.
   */
  username: string

  /** Width of stage (eg 480) */
  width: number

  /** Height of stage (eg 360) */
  height: number

  /** Whether the stage should be stretched to fill the screen. */
  stretch: boolean

  /** Whether to start the project automatically */
  autoStart: boolean

  /** Whether turbo mode is enabled */
  turbo: boolean

  /** FPS of the project */
  fps: number

  /**
   * Whether to enforce reasonable limits such as the maximum list length (on by
   * default in vanilla Scratch).
   */
  limits: boolean

  /**
   * Whether sprite fencing is enabled to prevent sprites from going off
   * screen (on by default in vanilla Scratch).
   */
  fencing: boolean

  /**
   * Whether to lock the cursor when the user clicks on the stage. The mouse x/y
   * blocks are set to the accumulative mouse position, so the `limits` option
   * should be `false` to allow it to extend beyond the stage.
   */
  pointerLock: boolean

  /**
   * A `File` containing an image to set the cursor to, or `'hidden'` to hide
   * the cursor, or `null` to use the default cursor.
   */
  cursor: File | 'hidden' | null

  /** A `File` containing the favicon image */
  favicon: File | null

  /** A `File` containing the background image */
  backgroundImage: File | null

  /**
   * List of URLs to the unofficial extensions that the project uses.
   *
   * @see https://github.com/LLK/scratch-vm/blob/develop/docs/extensions.md#types-of-extensions
   */
  extensions: string[]

  /** Customisation options for the loading screen */
  loading: {
    /** The colour of the loading progress bar or `null` for no progress bar */
    progressBar: Colour | null

    /**
     * An image to show while the project is loading. Either a `File`, a URL to
     * an image (not included inside the HTML file), or `null` for no image.
     */
    image: File | string | null

    /** Whether the loading image should be stretched to fill the screen. */
    stretch: boolean
  }

  /** Customisation options for the buttons on the top right of the page */
  buttons: {
    /** Start/stop buttons */
    startStop: boolean

    /** Fullscreen button */
    fullscreen: boolean
  }

  /** Customisation of monitor colours */
  monitors: {
    /**
     * Background colour of the list and variable monitors; `null` for
     * translucent black. If `'none'`, then the monitors will just be the
     * variable name and value text.
     */
    background: Colour | 'none' | null

    /** The text colour of the list and variable monitors */
    text: Colour
  }

  /**
   * Control the behaviour of cloud variables when HTMLified. Cloud variables
   * are stored in localStorage by default.
   */
  cloud: {
    /**
     * The URL of the cloud server, starting with `ws://` or `wss://`. `null` to
     * not use a web server.
     */
    serverUrl: string | null

    /**
     * Whether to use special cloud variable behaviours for cloud variables of
     * certain names. Some of these special cloud variables interact with web
     * APIs when set by the project, or are automatically set with a value such
     * as the URL of the page.
     *
     * @see https://github.com/SheepTester/htmlifier/wiki/Special-cloud-behaviours
     */
    specialBehaviours: boolean
  }
}

/** Converts a project to HTML */
export default class Htmlifier {
  private _vm: Promise<string> = fetch(
    'https://sheeptester.github.io/scratch-vm/16-9/vm.min.js'
  ).then(r => r.text())

  private _template: Promise<string> =
    typeof Deno !== 'undefined'
      ? Deno.readTextFile(new URL('./template.html', import.meta.url))
      : fetch(new URL('./template.html', import.meta.url)).then(r => r.text())

  private async _createHtml (
    projectSource: ProjectSource,
    {
      log,
      zip: outputZip,
      includeVm,
      title,
      username,
      width,
      height,
      stretch: stretchStage,
      autoStart,
      turbo,
      fps,
      limits,
      fencing,
      pointerLock,
      cursor,
      favicon,
      backgroundImage,
      extensions,
      loading: {
        progressBar,
        image: loadingImage,
        stretch: stretchLoadingImage
      },
      buttons: { startStop: startStopBtns, fullscreen: fullscreenBtns },
      monitors: { background: monitorBackground, text: monitorText },
      cloud: { serverUrl, specialBehaviours }
    }: HtmlifyOptions
  ): Promise<Blob> {
    const project = await getProject(projectSource, log)

    /** Files to externally include in the .zip file */
    const files: Map<string, Blob | string> = new Map()

    /**
     * Stores file in .zip if `outputZip` is enabled. Returns a URL (either a
     * replative path or a data URL) that can be fetched.
     */
    async function registerFile (
      fileName: string,
      file: Blob | string
    ): Promise<string> {
      if (outputZip) {
        files.set(fileName, file)
        return `./${fileName}`
      } else {
        return await getDataUrl(
          file instanceof Blob ? file : new Blob([file], { type: 'text/plain' })
        )
      }
    }

    /**
     * Object mapping from asset md5-extension to a fetchable URL. Can also be
     * `project` and `file`.
     */
    const assets: Record<string, string | unknown> = {}

    if (project.type === 'assets') {
      assets.project = await registerFile(
        'project.json',
        JSON.stringify(project.project)
      )
      for (const [md5Ext, file] of project.assets) {
        assets[md5Ext] = await registerFile(md5Ext, file)
      }
    } else {
      assets.file = await registerFile('project', project.file)
    }

    let html = await this._template
    const classes = []
    const styles: Record<string, string> = {}

    html = html.replace('{TITLE}', title)
    if (stretchStage) {
      classes.push('stretch-stage')
      html = html.replace('{WRAPPER_CSS}', '')
    } else {
      html = html.replace(
        '{WRAPPER_CSS}',
        [
          '<style>',
          `#wrapper { width: 100vw; height: ${(height / width) * 100}vw; }`,
          `@media (min-aspect-ratio: ${width}/${height}}) {`,
          `#wrapper { height: 100vh; width: ${(width / height) * 100}vh; }`,
          '}',
          '</style>'
        ].join('\n')
      )
    }
    if (cursor === 'hidden') {
      classes.push('no-cursor')
    } else if (cursor) {
      const cursorUrl = await registerFile(
        'cursor' + getFileExtension(cursor),
        cursor
      )
      styles.cursor = `url("${escapeCss(cursorUrl)}"), auto`
    }
    if (favicon) {
      const faviconUrl = await registerFile(
        'favicon' + getFileExtension(favicon),
        favicon
      )
      html = html.replace(
        '{FAVICON}',
        `<link rel="shortcut icon" type="image/png" href="${escapeHtml(
          faviconUrl
        )}">`
      )
    } else {
      html = html.replace('{FAVICON}', '')
    }
    if (backgroundImage) {
      const imageUrl = await registerFile(
        'favicon' + getFileExtension(backgroundImage),
        backgroundImage
      )
      styles['background-image'] = `url("${escapeCss(imageUrl)}")`
    }
    // TODO: extensions
    if (progressBar) {
      classes.push('show-loading-progress')
      styles['--progress-colour'] = progressBar
    }
    if (loadingImage) {
      const imageUrl =
        loadingImage instanceof File
          ? await registerFile(
              'loading' + getFileExtension(loadingImage),
              loadingImage
            )
          : loadingImage
      html = html.replace(
        '{LOADING_IMAGE}',
        `<img src="${escapeHtml(imageUrl)}" id="loading-image">`
      )
    }
    if (stretchLoadingImage) {
      classes.push('stretch-loading-image')
    }
    if (fullscreenBtns) {
      classes.push('show-fullscreen-btn')
    }
    if (startStopBtns) {
      classes.push('show-start-stop-btns')
    }
    if (monitorBackground === null || monitorBackground !== 'none') {
      classes.push('show-monitor-box')
      if (monitorBackground) {
        styles['--monitor-colour'] = monitorBackground
      }
    }
    styles['--monitor-text'] = monitorText

    html = html.replace('{CLASSES}', classes.join(' ')).replace(
      '{STYLES}',
      Object.keys(styles).length > 0
        ? `style="\n${Object.entries(styles)
            .map(([prop, value]) => `${prop}: ${escapeHtml(value)};`)
            .join('\n')}\n"`
        : ''
    )

    // TODO: {CSS}, {VM}, {SCRIPTS}

    if (outputZip) {
      const zip = new JSZip()
      for (const [fileName, file] of files) {
        zip.file(fileName, file)
      }
      zip.file('index.html', html)
      zip.file(
        'README.txt',
        "You can't just open the index.html directly in the browser, unfortunately. Read https://github.com/SheepTester/htmlifier/wiki/Downloading-as-a-.zip\n"
      )
      return await zip.generateAsync({ type: 'blob' })
    } else {
      return new Blob([html], { type: 'text/html' })
    }
  }

  async htmlify (
    project: ProjectSource,
    options: HtmlifyOptions
  ): Promise<Blob> {
    return await this._createHtml(project, options)
  }
}
