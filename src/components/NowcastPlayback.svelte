<script>
  import { Play, Pause, ChevronsDown, ChevronsUp, History, Repeat } from '../lib/IconRegistry'
  import { fly, fade } from 'svelte/transition'
  import { onMount, onDestroy } from 'svelte'

  // XState migration imports
  import { createNowcastPlaybackMachine } from '../lib/nowcast-playback-machine.js'
  import { createMachineService, getCurrentState } from '../lib/xstate-svelte.js'

  import {
    lastFocus,
    sharedActiveCap,
    cycloneLayerVisible,
    lightningLayerVisible,
    bottomToolbarMode,
    radarColormap,
    precacheForecast,
  } from '../stores'

  // Lazy loading function for Chart.js
  let chartLibraryLoaded = false
  let Chart, BarWithErrorBarsChart, ChartDataLabels

  async function loadChartLibrary() {
    if (chartLibraryLoaded) return

    try {
      // Dynamically import Chart.js modules
      const chartjsModule = await import('chart.js')
      const chartErrorBarsModule = await import('chartjs-chart-error-bars')
      const chartDataLabelsModule = await import('chartjs-plugin-datalabels')

      // Extract the needed classes
      Chart = chartjsModule.Chart
      BarWithErrorBarsChart = chartErrorBarsModule.BarWithErrorBarsChart
      ChartDataLabels = chartDataLabelsModule.default

      // Register chart components
      Chart.register(chartjsModule.CategoryScale)
      Chart.register(chartjsModule.LinearScale)
      Chart.register(chartjsModule.BarController)
      Chart.register(chartjsModule.BarElement)
      Chart.register(ChartDataLabels)

      chartLibraryLoaded = true
    } catch (error) {
      logger.error('Failed to load Chart.js library:', error)
    }
  }

  import { setUIConstant } from '../layers/ui'
  import { DeviceDetect as dd } from '../lib/DeviceDetect'
  import { logger } from '../lib/logger.js'

  import TimeIndicator from './TimeIndicator.svelte'
  import LastUpdated from './LastUpdated.svelte'
  import Appendix from './Appendix.svelte'
  import RadarScaleLine from './scales/RadarScaleLine.svelte'
  import LiveIndicator from './LiveIndicator.svelte'
  import DevStatus from './DevStatus.svelte'
  import { _ } from 'svelte-i18n'
  import { get } from 'svelte/store'
  import { dbz2color } from '../lib/cmap_utils'

  let { cap } = $props()

  let gridConfig = $state(null)

  let canvasVisible = $state(true)
  let showOpenControls = $state(false)
  let buttonBarAlignTimeout

  let oldTimeStep = $state(0)

  let playPauseButton = $state(Play)
  let playTimeout

  const updateButtonBarAlignment = () => {
    if (!dd.isApp() || typeof document === 'undefined') return
    const lastUpdated = document.querySelector('.bottomToolbar.lastUpdatedBottom .info')
    const controlButton = document.querySelector('.buttonBar .controlButton')
    if (!lastUpdated || !controlButton) {
      document.documentElement.style.removeProperty('--buttonbar-bottom')
      return
    }
    const lastRect = lastUpdated.getBoundingClientRect()
    const lastCenter = lastRect.top + lastRect.height / 2
    const buttonRect = controlButton.getBoundingClientRect()
    const barHalf = buttonRect.height / 2
    const buttonBarBottom = Math.max(0, Math.round(window.innerHeight - lastCenter - barHalf))
    document.documentElement.style.setProperty('--buttonbar-bottom', `${buttonBarBottom}px`)
  }

  const scheduleButtonBarAlignment = () => {
    if (buttonBarAlignTimeout) {
      window.clearTimeout(buttonBarAlignTimeout)
    }
    buttonBarAlignTimeout = window.setTimeout(() => {
      updateButtonBarAlignment()
      buttonBarAlignTimeout = null
    }, 0)
  }

  let slRange = $state(null)
  $effect(() => {
    if (slRange) {
      window.slr = slRange
    } else if (window.slr) {
      window.slr = null
    }
  })

  $effect(() => {
    if (!dd.isApp()) return
    if (!showOpenControls) {
      document.documentElement.style.removeProperty('--buttonbar-bottom')
      return
    }
    window.requestAnimationFrame(() => updateButtonBarAlignment())
    scheduleButtonBarAlignment()
    const handleResize = () => updateButtonBarAlignment()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  })

  let loop = $state(true)
  let historicActive = $state(true)
  let includeHistoric = $state(false)
  let canvas

  let buttonSize = $state('small')
  if (dd.isApp()) {
    buttonSize = 'medium'
  }
  // window.onresize = () => {
  //   if (window.innerWidth < 990) {
  //     buttonSize = "medium";
  //   } else {
  //     buttonSize = "small";
  //   }
  // };

  let autoPlay = $state(false)
  let chart = null

  async function redraw(config) {
    if (!config) return
    logger.log('Redrawing')
    const { grid } = config
    logger.log('Grid config:', { start: config.start, end: config.end, now: config.now })
    if (!canvas) {
      logger.log('Grid not yet initialized, skipping redraw')
      return
    }

    // Lazy load Chart.js when needed
    await loadChartLibrary()
    if (!chartLibraryLoaded) {
      logger.error('Chart.js library failed to load')
      return
    }
    // if (Object.values(grid).map((step) => step.dbz).reduce((a, b) => a + b, 0) === 0) {
    //   canvasVisible = false;
    //   return;
    // }
    const sortedKeys = Object.keys(grid)
      .map((e) => parseInt(e, 10))
      .sort()
    // with error bars:
    // return {y: grid[step].dbz, yMin: grid[step].dbz - grid[step].dbzMin, yMax: grid[step].dbz + grid[step].dbzMax};
    const d = sortedKeys.map((step) => ({ y: Math.max(0, grid[step] != null ? grid[step].dbz : 0) }))
    if (chart) chart.destroy()

    let skip = 5
    if (dd.breakpoint() === 'reduced') {
      skip = 10
    }
    if (dd.breakpoint() === 'small') {
      skip = 20
    }

    const values = d.map((step) => step.y)
    values.splice(-1)

    const dataMin = Math.min(...values)
    // XXX replace by local maxima/sliding window
    const max = Math.max(...values)
    const maxIndexes = []
    values.forEach((item, index) => (item === max ? maxIndexes.push(index) : null))
    const disabled = values.every((e) => e === 0)

    const gridKeys = Object.keys(grid)
    const rendered = {}

    // Log canvas dimensions for debugging
    logger.log('Canvas dimensions:', {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
    })

    chart = new BarWithErrorBarsChart(canvas.getContext('2d'), {
      data: {
        labels: sortedKeys.map((key) => (key - config.now) / 60),
        datasets: [
          {
            data: d,
            barPercentage: 0.99,
            categoryPercentage: 0.99,
            backgroundColor: d
              .map((value) => dbz2color(value.y, get(radarColormap)))
              .map(([r, g, b], index) => {
                if (grid[sortedKeys[index]] == null) {
                  return `rgba(0, 0, 0, 1)`
                }
                const certain = grid[sortedKeys[index]].source === 'observation' ? 1 : 0.7
                return `rgba(${r}, ${g}, ${b}, ${certain})`
              }),
            borderColor: d.map((value, index) =>
              gridKeys[index] === `${cap.getMostRecentObservation()}`
                ? '#ff0000'
                : getComputedStyle(document.body).getPropertyValue('--sl-color-info-700'),
            ),
            borderWidth: 1,
          },
        ],
      },
      options: {
        animation: {
          duration: 0,
        },
        hover: {
          animationDuration: 0,
        },
        // animation: {
        //   onComplete: (chart) => {
        //     const chartInstance = chart,
        //             ctx = canvas.getContext("2d");

        //     ctx.font = fontString(
        //             18,
        //             "Italic",
        //             "Sans",
        //     );
        //     ctx.textAlign = "center";
        //     ctx.textBaseline = "bottom";

        //     chartInstance.data.datasets.forEach(function(dataset, i) {
        //       const meta = chartInstance.controller.getDatasetMeta(i);
        //       meta.data.forEach(function(bar, index) {
        //         const data = dataset.data[index];
        //         ctx.fillStyle = "#000";
        //         ctx.fillText(data, bar._model.x, bar._model.y - 2);
        //       });
        //     });
        //   }
        // },
        layout: {
          padding: {
            left: 8,
            right: 8,
            top: 40,
            bottom: 0,
          },
        },
        responsive: true,
        maintainAspectRatio: false,
        legend: {
          display: false,
        },
        // Add callback to log chart resize events
        onResize: (chart, size) => {
          logger.log('Chart resized:', { width: size.width, height: size.height })
        },
        tooltips: {
          enabled: false,
        },
        plugins: {
          datalabels: {
            clamp: true,
            textAlign(context) {
              if (context.dataIndex > 25) {
                return 'end'
              }
              return 'end'
            },
            align() {
              return 'top'
            },
            anchor(context) {
              // Prevent labels at the edges from extending beyond bounds
              const totalLabels = context.chart.data.labels.length
              if (context.dataIndex === 0 || context.dataIndex === totalLabels - 1) {
                return 'center' // Use center anchor for edge labels to keep them within bounds
              }
              return 'end'
            },
            borderRadius: 4,
            color: 'white',
            borderColor: 'white',
            borderWidth: 1,
            rotation() {
              return 270
            },
            backgroundColor(context) {
              return context.dataset.backgroundColor
            },
            formatter: (val, context) => {
              if (disabled) {
                return null
              }
              if (context.dataIndex - 1 in rendered || context.dataIndex - 2 in rendered) {
                return null
              }

              // Log data label positioning for debugging
              if (context.dataIndex === 0 || context.dataIndex === context.chart.data.labels.length - 1) {
                logger.log('Data label at edge:', {
                  dataIndex: context.dataIndex,
                  label: context.chart.data.labels[context.dataIndex],
                  value: val.y,
                })
              }
              if (Number(context.chart.data.labels[context.dataIndex]) === 0) {
                rendered[context.dataIndex] = true
                return $_('now')
              }

              // XXX calculate slope instead
              if (context.dataIndex > 0) {
                try {
                  if (
                    context.chart.data.datasets[0].data[context.dataIndex - 1].y - dataMin === 0 &&
                    val.y - dataMin > 0 &&
                    context.chart.data.datasets[0].data[context.dataIndex + 1].y - dataMin !== 0
                  ) {
                    rendered[context.dataIndex] = true
                    return `${context.chart.data.labels[context.dataIndex]}m`
                  }

                  if (val.y - dataMin > 0 && context.chart.data.datasets[0].data[context.dataIndex + 1].y - dataMin === 0) {
                    rendered[context.dataIndex] = true
                    return `${context.chart.data.labels[context.dataIndex]}m`
                  }

                  if (maxIndexes.includes(context.dataIndex)) {
                    rendered[context.dataIndex] = true
                    return `${context.chart.data.labels[context.dataIndex]}m`
                  }
                } catch (e) {
                  logger.error(e)
                  return null
                }
              }
              return null
            },
            padding: 3,
            offset: 2,
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
              tickMarkLength: 6,
              drawBorder: false,
            },
            // Log x-axis configuration for debugging
            afterBuildTicks: (axis) => {
              logger.log(
                'X-axis ticks:',
                axis.ticks.map((t) => ({ label: t.label, value: t.value })),
              )
            },
            afterFit: (scale) => {
              scale.height = 18
              scale.paddingBottom = 0
            },
            afterUpdate: (scale) => {
              scale.height = 18
              scale.paddingBottom = 0
            },
            ticks: {
              color: getComputedStyle(document.body).getPropertyValue('--sl-color-info-700'),
              fontSize: 5,
              autoSkip: false,
              callback(value) {
                const label = this.getLabelForValue(value)
                if (label === 0) {
                  return 'now'
                }
                if (label == -120) {
                  return '-2h'
                }
                if (label == -60) {
                  return '-1h'
                }
                if (label == 60) {
                  return '1h'
                }
                if (label == 120) {
                  return '2h'
                }
                const labelValue = Number(label)
                if (!Number.isFinite(labelValue)) {
                  return ''
                }
                if (labelValue === 0) {
                  return 'now'
                }
                if (Math.abs(labelValue) % skip === 0) {
                  return `${labelValue}`
                }
                return ''
              },
              minRotation: 0,
              maxRotation: 0,
              responsive: true,
              padding: -4,
              display: $bottomToolbarMode === 'player',
              autoSkipPadding: 0,
              // Ensure axis labels stay within bounds
              maxPadding: 0.1,
              minPadding: 0.1,
            },
          },
          y: {
            type: 'linear',
            grid: {
              display: false,
              drawBorder: false,
            },
            ticks: {
              display: false,
              beginAtZero: true,
            },
            max: 95,
            min: 0,
          },
        },
      },
    })
  }
  $effect(() => {
    redraw(gridConfig)
  })

  function updateSliderToLatest() {
    if (slRange) slRange.value = `${cap.getMostRecentObservation()}`
  }

  $effect(() => {
    updateSliderToLatest(gridConfig)
  })

  function canvasInit(elem) {
    canvas = elem
    if ($bottomToolbarMode === 'player') {
      canvas.parentNode.classList.remove('barChartCanvasWithoutPlayback')
    }
    redraw(gridConfig)
  }

  const xstateMachine = createNowcastPlaybackMachine({
    onShowScrollbar: () => {
      bottomToolbarMode.set('player')
      if ($precacheForecast === true) {
        cap.precacheAllForecasts()
      }
      if (chart) {
        canvasVisible = false
        chart.options.scales.x.ticks.display = true
        setTimeout(() => {
          canvasVisible = true
          chart.update()
        }, 400)
      }
      playPauseButton = Play
      if (slRange) slRange.value = `${cap.getMostRecentObservation()}`
      setTimeout(() => {
        if (slRange) slRange.value = `${cap.getMostRecentObservation()}`
      }, 200)
      setUIConstant('toast-stack-offset', '124px')

      if (autoPlay) {
        setTimeout(() => {
          logger.log('Triggering auto-play')
          if (cap.source && xstateState?.value === 'manualScrolling') {
            xstateService.send({ type: 'PRESS_PLAY' })
          } else {
            setTimeout(() => {
              logger.log('Triggering deferred auto-play')
              xstateService.send({ type: 'PRESS_PLAY' })
            }, 1000)
          }
        }, 500)
        autoPlay = false
      }
    },

    onPressPlay: () => {
      const playTick = (ttl = 10) => {
        if (!slRange) {
          if (ttl < 1) {
            logger.error('slRange element did not appear')
            return
          }
          setTimeout(() => playTick(ttl - 1), 200)
          return
        }
        let thisFrameDelayMs = 450
        const sliderValueInt = parseInt(slRange.value, 10)
        if (sliderValueInt >= gridConfig.end) {
          slRange.value = (includeHistoric ? gridConfig.start : gridConfig.now).toString()
        } else {
          slRange.value = (sliderValueInt + 5 * 60).toString()
        }
        if (sliderValueInt === 0) {
          thisFrameDelayMs = 800
        }
        sliderChangedHandler(slRange.value)
        if (slRange.value !== gridConfig.now || loop) {
          playTimeout = window.setTimeout(playTick, thisFrameDelayMs)
        } else {
          playTimeout = 0
          logger.log('Pausing due to slider usage')
          xstateService.send({ type: 'PRESS_PAUSE' })
        }
      }
      playTick()
      playPauseButton = Pause
    },

    onPressPause: () => {
      if (playTimeout !== 0) window.clearTimeout(playTimeout)
      playTimeout = 0
      playPauseButton = Play
    },

    onHideScrollbar: () => {
      oldTimeStep = 0
      slRange = null
      cap.resetToLatest()
      if (canvas) canvas.parentNode.classList.add('barChartCanvasWithoutPlayback')
      if (chart) {
        chart.options.scales.x.ticks.display = false
        canvasVisible = false
        setTimeout(() => {
          canvasVisible = true
          chart.update()
        }, 400)
      }
      setUIConstant('toast-stack-offset')
      bottomToolbarMode.set('collapsed')
    },
  })

  let xstateService = null
  let xstateState = $state(null)

  const createService = createMachineService(xstateMachine)
  xstateService = createService()
  xstateState = getCurrentState(xstateService)

  // Subscribe to state changes
  xstateService.subscribe((state) => {
    xstateState = state
  })

  function show() {
    if (xstateService) xstateService.send({ type: 'SHOW_SCROLLBAR' })
    bottomToolbarMode.set('player')
  }

  function showAndPlay() {
    autoPlay = true
    show()
  }

  function hide() {
    if (playTimeout !== 0) window.clearTimeout(playTimeout)
    playTimeout = 0
    xstateService.send({ type: 'HIDE_SCROLLBAR' })
  }

  onMount(async () => {
    window.leaveForeground = () => {
      if (xstateState?.value === 'playing') {
        logger.log('Pausing due to window.leaveForeground();')
        xstateService.send({ type: 'PRESS_PAUSE' })
      }
    }

    cap.addObserver((subject, data) => {
      logger.log(`NowcastPlayback observed event ${subject}`)
      if (subject === 'grid' && data) {
        gridConfig = data
        showOpenControls = true
      }
      //   // const gridSteps = Object.keys(grid);
      //   let changed = false;
      //   Object.keys(data)
      //           .forEach((key) => {
      //             if (key in grid) {
      //               grid[key].dbz = data[key].dbz;
      //               grid[key].dbzMin = data[key].dbzMin;
      //               grid[key].dbzMax = data[key].dbzMax;
      //               grid[key].url = data[key].url;
      //               grid[key].source = data[key].source;
      //               changed = true;
      //             }
      //           });
      //   if (changed) redraw();

      //   const mostRecentTimestamp = cap.getMostRecentObservation();
      //   if ($bottomToolbarMode !== 'player' && mostRecentTimestamp in grid) {
      //     cap.setUrl(grid[mostRecentTimestamp].url);
      //     capTimeIndicator.set(mostRecentTimestamp);
      //   }
      // }
      // if (subject === "historic") {
      //  historicLayers = data.sources;
      // } else if (subject === "nowcast") {
      //  nowcastLayers = data.sources;
      // } else {
      //  return;
      // }
      // if (historicLayers && nowcastLayers) {
      //   if (fsm.state === "waitingForServer") {
      //     fsm.showScrollbar();
      //   }
      //   const reversed = Object.values(historicLayers);
      //   reversed.reverse();
      //   rainValues = reversed
      //     .map((layer) => Math.round(layer.reported_intensity + 32.5))
      //     .concat(Object.values(nowcastLayers)
      //       .map((layer) => Math.round(layer.reported_intensity + 32.5)));
      //   setChart();
      // } else {
      //   switch (fsm.state) {
      //     case "manualScrolling":
      //       fsm.enterWaitingState();
      //       break;
      //     case "playing":
      //       autoPlay = true;
      //       fsm.enterWaitingState();
      //       break;
      //     default:
      //       break;
      //   }
      // }
    })
    cap.notifyObservers()

    cap.addObserver((event) => {
      if (event === 'loseFocus') {
        hide()
      }
    })
  })

  function sliderChangedHandler(value, userInteraction = false) {
    const numericValue = typeof value === 'string' ? Number.parseInt(value, 10) : value
    if (Number.isNaN(numericValue)) {
      logger.log('sliderChangedHandler called with NaN')
      return
    }
    if (numericValue === oldTimeStep) return

    if (userInteraction) {
      if (xstateState?.value === 'playing') {
        logger.log('Pausing due to sliderChangedHandler')
        xstateService.send({ type: 'PRESS_PAUSE' })
      }
    }

    if (userInteraction && dd.isIos()) {
      let impact = 'Light'
      if (numericValue === 0) {
        impact = 'Medium'
      }
      window.webkit.messageHandlers.scriptHandler.postMessage(`impact${impact}`)
    }

    cap.setSource(numericValue)
    // if (value in grid && 'url' in grid[value] && grid[value].url) {
    //   cap.setUrl(grid[value].url);
    //   capTimeIndicator.set(value);
    // }
    oldTimeStep = numericValue
  }

  function playPause() {
    if (xstateState?.value === 'playing') {
      logger.log('Pausing due to button')
      xstateService.send({ type: 'PRESS_PAUSE' })
    } else {
      xstateService.send({ type: 'PRESS_PLAY' })
    }
  }

  function toggleLoop() {
    loop = !loop
    historicActive = loop
    if (!historicActive) includeHistoric = false
  }

  function toggleHistoric() {
    includeHistoric = !includeHistoric
  }

  function toggleLightning() {
    lightningLayerVisible.set(!$lightningLayerVisible)
  }

  function toggleCyclones() {
    cycloneLayerVisible.set(!$cycloneLayerVisible)
  }

  let last = new Date()
  lastFocus.subscribe((focus) => {
    if (focus.getTime() > last.getTime() + 2 * 60 * 1000 && cap.trackingMode !== 'live') {
      hide()
      cap.resetToLatest()
    }
    last = focus
  })

  onDestroy(() => {
    // Clean up timeouts
    if (playTimeout !== 0) {
      clearTimeout(playTimeout)
      playTimeout = 0
    }
    if (buttonBarAlignTimeout) {
      clearTimeout(buttonBarAlignTimeout)
      buttonBarAlignTimeout = null
    }

    // Clean up XState service
    if (xstateService) {
      try {
        xstateService.stop()
      } catch (error) {
        logger.warn('Error stopping XState service:', error)
      }
    }

    // Clean up chart if it exists
    if (chart) {
      try {
        chart.destroy()
      } catch (error) {
        logger.warn('Error destroying chart:', error)
      }
      chart = null
    }

    // Clean up global references
    if (window.slr === slRange) {
      window.slr = null
    }
  })
</script>

<LiveIndicator />
{#if import.meta.env.DEV}
  <DevStatus />
{/if}

{#if canvasVisible && $sharedActiveCap === 'radar'}
  <div
    class="barChartCanvas barChartCanvasWithoutPlayback"
    id="barChartCanvas"
    out:fly={{ y: 60, duration: 200 }}
    in:fade={{ duration: 200 }}
  >
    <canvas use:canvasInit></canvas>
  </div>
{/if}
{#if $bottomToolbarMode === 'player'}
  <div class="bottomToolbar timeslider" transition:fly={{ y: 150, duration: 400 }}>
    <div class="flexbox">
      <div class="buttonsLeft">
        <div
          class="controlButton"
          onclick={playPause}
          title="Play/Pause"
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && playPause()}
        >
          {#if playPauseButton === Play}<Play class="controlIconInline" />{:else}<Pause class="controlIconInline" />{/if}
        </div>
        <div class="controlButton" onclick={hide} title="Close" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && hide()}>
          <ChevronsDown class="controlIcon" />
        </div>
      </div>
      <div class="slider">
        <input
          type="range"
          min={gridConfig.start}
          max={gridConfig.end}
          step={60 * 5}
          class="range ui-range"
          bind:this={slRange}
          onchange={(event) => sliderChangedHandler(event.currentTarget.value, true)}
        />
        <div class="flexbox gap">
          <div class="checkbox">
            <div class="button-group-toolbar">
              <div class="ui-button-group" role="group" aria-label="Playback Controls">
                <button
                  type="button"
                  class="ui-button"
                  class:ui-button--medium={buttonSize === 'medium'}
                  onclick={playPause}
                  aria-pressed={xstateState?.value === 'playing'}
                >
                  <div class="faIconButton">
                    {#if playPauseButton === Play}<Play />{:else}<Pause />{/if}
                  </div>
                </button>
                <button
                  type="button"
                  class="ui-button"
                  class:ui-button--medium={buttonSize === 'medium'}
                  class:is-primary={loop}
                  onclick={toggleLoop}
                  aria-pressed={loop}
                >
                  <div class="faIconButton">
                    <Repeat />
                  </div>
                </button>
                <button
                  type="button"
                  class="ui-button"
                  class:ui-button--medium={buttonSize === 'medium'}
                  class:is-primary={includeHistoric}
                  disabled={!historicActive}
                  onclick={toggleHistoric}
                  aria-pressed={includeHistoric}
                >
                  <div class="faIconButton">
                    <History />
                  </div>
                </button>
              </div>
            </div>
          </div>
          <div class="checkbox">
            <div class="button-group-toolbar">
              <div class="ui-button-group" role="group" aria-label="Map Layers">
                <button
                  type="button"
                  class="ui-button"
                  class:ui-button--medium={buttonSize === 'medium'}
                  class:is-primary={$lightningLayerVisible}
                  onclick={toggleLightning}
                  aria-pressed={$lightningLayerVisible}
                >
                  ⚡ <span class="hide-on-small-screens">Lightning Strikes</span>
                </button>
                <button
                  type="button"
                  class="ui-button"
                  class:ui-button--medium={buttonSize === 'medium'}
                  class:is-primary={$cycloneLayerVisible}
                  onclick={toggleCyclones}
                  aria-pressed={$cycloneLayerVisible}
                >
                  🌀 <span class="hide-on-small-screens">Mesocyclones</span>
                </button>
              </div>
            </div>
          </div>
          <div class="checkbox buttonsInline">
            <div class="button-group-toolbar">
              <button type="button" class="ui-button" class:ui-button--medium={buttonSize === 'medium'} onclick={hide}>
                <div class="faIconButton">
                  <ChevronsDown />️
                </div>
              </button>
            </div>
          </div>
          <div class="break"></div>
          <div class="checkbox">
            <TimeIndicator />
          </div>
          <div class="checkbox">
            <LastUpdated />
          </div>
          <div class="break"></div>
          {#if !dd.isApp()}
            <div class="checkbox hide-on-small-screens" style="flex-grow: 1;">
              <RadarScaleLine />
            </div>
            <div class="checkbox hide-on-small-screens">
              <Appendix />
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{:else if $sharedActiveCap === 'radar'}
  {#if showOpenControls}
    <div onclick={show} class="buttonBar right" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && show()}>
      <div class="controlButton" title="Playback Controls">
        <div class="playHover">
          <ChevronsUp class="controlIcon" />
        </div>
      </div>
    </div>
    <div onclick={showAndPlay} class="buttonBar" role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && showAndPlay()}>
      <div class="controlButton" title="Play/Pause">
        <div class="playHover">
          <Play class="controlIcon" />
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .timeslider {
    height: var(--bottom-toolbar-expanded-height, 90px);
    z-index: 100001;
    padding-top: 6px;
  }

  /* timeline controls */

  .controlButton {
    width: 1em;
    height: 1em;
    padding: 0.5em;
    border: 1px solid grey;
    border-radius: 5px;
    flex: 1 1 auto;
    text-align: center;
    margin: 0.3em 0.25em 0.4em 0.25em;
    cursor: pointer;
    color: var(--sl-color-black);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .controlButton:hover {
    cursor: pointer;
    background-color: var(--sl-color-black);
    border: 1px solid var(--sl-color-black);
    color: var(--sl-color-white);
  }

  .buttonBar {
    position: absolute;
    bottom: env(safe-area-inset-bottom);
    left: 0.3em;
    z-index: 100000;
  }

  .buttonBar.right {
    left: 3em;
    right: unset;
  }

  :global(.is-app .buttonBar) {
    /* bottom: var(--buttonbar-bottom, calc(var(--bottom-toolbar-height, 0px) - env(safe-area-inset-bottom) + 8px)); */
    left: calc(0.3em + 5px);
  }

  :global(.is-app .buttonBar.right) {
    left: calc(3em + 5px);
  }

  .flexbox {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-evenly;
  }

  .flexbox > .slider {
    flex-grow: 1; /* do not grow   - initial value: 0 */
    flex-shrink: 1; /* do not shrink - initial value: 1 */
    flex-basis: 85%;
    padding-right: 1em;
  }

  .flexbox > .buttonsInline {
    display: none;
  }

  .flexbox > .buttonsLeft {
    flex-grow: 0; /* do not grow   - initial value: 0 */
    flex-shrink: 0; /* do not shrink - initial value: 1 */
    flex-basis: 3%;
    min-width: 30px;
    margin-right: 0.5%;
    margin-left: 0.5%;
  }

  .range {
    width: 100%;
    top: 5px;
  }

  .ui-range {
    accent-color: var(--sl-color-primary-600);
  }

  .checkbox {
    margin-top: 4px;
  }

  .button-group-toolbar {
    display: inline-flex;
    align-items: center;
  }

  .ui-button-group {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding: 0.1em;
    border-radius: 6px;
    border: 1px solid var(--sl-color-gray-200);
    background: var(--sl-color-white);
  }

  .ui-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    padding: 0 0.5em;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: var(--sl-color-black);
    cursor: pointer;
    font-size: 0.75rem;
  }

  .ui-button--medium {
    min-width: 36px;
    height: 36px;
    font-size: 0.85rem;
  }

  .ui-button.is-primary {
    background: var(--sl-color-primary-600);
    color: var(--sl-color-primary-text);
  }

  .ui-button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ui-button:focus-visible {
    outline: 2px solid var(--sl-color-primary-600);
    outline-offset: 2px;
  }

  .faIconButton {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
  }

  /* Ensure consistent Lucide icon sizing within buttons */
  .faIconButton :global(svg) {
    width: 14px !important;
    height: 14px !important;
  }

  :global(.controlIcon) {
    width: 14px !important;
    height: 14px !important;
    display: block;
    margin: 0 auto;
  }

  :global(.controlIcon svg) {
    width: 14px !important;
    height: 14px !important;
  }

  :global(.controlIconInline) {
    width: 12px !important;
    height: 12px !important;
    display: block;
    margin: 0 auto;
  }

  :global(.controlIconInline svg) {
    width: 12px !important;
    height: 12px !important;
  }

  .barChartCanvas {
    position: absolute;
    bottom: calc(env(safe-area-inset-bottom) + 79px);
    width: 97%;
    left: 2.9%;
    height: 150px;
    pointer-events: none;
    margin-right: 0.5em;
    z-index: 7;
    /* Debug: Add border to see container bounds */
    /* border: 1px solid red; */
    overflow: hidden; /* Prevent content from overflowing */
  }

  .barChartCanvasWithoutPlayback {
    bottom: calc(env(safe-area-inset-bottom) + 31px);
    width: 100% !important;
    left: 0;
  }

  .gap {
    gap: 18px;
  }

  @media only screen and (max-width: 620px) {
    .flexbox > .slider {
      margin-bottom: 0px;
      padding-right: 0.1em;
    }

    .range {
      margin-bottom: 0px;
      margin-top: 24px;
    }

    .barChartCanvas {
      bottom: 118px;
      left: 0;
      width: 99%;
    }
    .barChartCanvasWithoutPlayback {
      bottom: calc(env(safe-area-inset-bottom) + 73px);
    }

    .flexbox > .buttonsInline {
      display: unset;
    }

    .flexbox > .buttonsLeft {
      display: none;
    }

    .flexbox {
      gap: 4px !important;
      padding-left: 1%;
      padding-right: 1%;
      margin-top: -4px;
    }

    .timeslider {
      height: 120px !important;
      display: flex;
      align-items: flex-end;
      padding-bottom: env(safe-area-inset-bottom);
      padding-top: 0;
      box-sizing: border-box;
    }

    .hide-on-small-screens {
      display: none;
    }

    .break {
      flex-basis: 100%;
      height: 0;
    }

    .buttonBar.right {
      left: unset;
      right: calc(0.3em + 5px);
    }

    .checkbox {
      margin-top: 2px;
    }

    .gap {
      gap: 10px;
    }
  }
</style>
