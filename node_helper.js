/* MagicMirror²
 * Module: MMM-NYC-transit
 *
 * By Elan Trybuch https://github.com/elaniobro
 * MIT Licensed.
 */
var NodeHelper = require('node_helper')
var { createClient } = require('mta-realtime-subway-departures')
var fs = require('fs-extra')
var mtaStationIds = require('mta-subway-stations')

module.exports = NodeHelper.create({
  start: function () {
    console.log( this.name + ' helper method started...'); /*eslint-disable-line*/
  },

  getDepartures: async function (config) {
    var apiKey = config.apiKey
    var client = createClient(apiKey)
    var self = this
    var stations = config.stations.map((obj) => obj.stationId)
    var stationIds = {}
    var walkingTime = config.stations.map((obj) => obj.walkingTime)
    var dirUpTown = config.stations.map((obj) => obj.dir.upTown)
    var dirDownTown = config.stations.map((obj) => obj.dir.downTown)
    var isList = config.displayType !== 'marquee'

    fs.readFile(
      `${__dirname}/node_modules/mta-subway-complexes/complexes.json`,
      'utf8'
    )
      .then((data) => {
        stationIds = JSON.parse(data)
      })
      .catch((err) => {
        throw new Error(err)
      })

    await this.processStationsWithErrorHandling(stations, client, self, stationIds, walkingTime, dirUpTown, dirDownTown, mtaStationIds, isList)
  },

  processStationsWithErrorHandling: async function(stations, client, self, stationIds, walkingTime, dirUpTown, dirDownTown, mtaStationIds, isList) {
    var upTown = []
    var downTown = []
    var failedStations = []

    try {
      // Try processing all stations together (existing behavior)
      console.log('Processing all stations together...')
      const responses = await client.departures(stations)

      this.processResponses(responses, upTown, downTown, stationIds, walkingTime, dirUpTown, dirDownTown, mtaStationIds)

      // Send successful results
      this.sendTrainData(self, stations, upTown, downTown, isList, failedStations)

    } catch (bulkError) {
      console.log('Bulk processing failed:', bulkError.message)
      console.log('Falling back to individual station processing...')

      // Fall back to processing stations individually
      for (let i = 0; i < stations.length; i++) {
        try {
          console.log(`Processing station ${stations[i]} individually...`)
          const response = await client.departures([stations[i]])

          // Process this single station's response
          const singleStationUpTown = []
          const singleStationDownTown = []

          this.processResponses([response], singleStationUpTown, singleStationDownTown, stationIds, [walkingTime[i]], [dirUpTown[i]], [dirDownTown[i]], mtaStationIds)

          // Add to combined results
          upTown.push(...singleStationUpTown)
          downTown.push(...singleStationDownTown)

          console.log(`✅ Station ${stations[i]} processed successfully`)

        } catch (stationError) {
          console.log(`❌ Station ${stations[i]} failed:`, stationError.message)
          failedStations.push({
            stationId: stations[i],
            error: stationError.message
          })
        }
      }

      // Send results (even if some stations failed)
      this.sendTrainData(self, stations, upTown, downTown, isList, failedStations)
    }
  },

  processResponses: function(responses, upTown, downTown, stationIds, walkingTime, dirUpTown, dirDownTown, mtaStationIds) {
    // Normalize responses to array format
    if (responses.length === undefined) {
      const temp = responses
      responses = []
      responses.push(temp)
    }

    responses.forEach((response, n) => {
      if (!response || !response.lines) {
        console.log(`Warning: No line data for station index ${n}`)
        return
      }

      response.lines.forEach((line) => {
        // Southbound Departures
        if (line.departures && line.departures.S) {
          line.departures.S.forEach((i) => {
            // Map Station ID to Complex ID
            for (var key in mtaStationIds) {
              if (i.destinationStationId === mtaStationIds[key]['Station ID']) {
                i.destinationStationId = mtaStationIds[key]['Complex ID']
              }
            }

            if (i.destinationStationId !== undefined && dirDownTown[n]) {
              try {
                downTown.push({
                  routeId: i.routeId,
                  time: this.getDate(i.time, walkingTime[n]),
                  destination:
                    i.destinationStationId === '281'
                      ? stationIds['606'].name
                      : stationIds[i.destinationStationId].name,
                  walkingTime: walkingTime[n],
                })
              } catch (processingError) {
                console.log('Error processing southbound departure:', processingError.message)
              }
            }
          })
        }

        // Northbound Departures
        if (line.departures && line.departures.N) {
          line.departures.N.forEach((i) => {
            // Map Station ID to Complex ID
            for (var key in mtaStationIds) {
              if (i.destinationStationId === mtaStationIds[key]['Station ID']) {
                i.destinationStationId = mtaStationIds[key]['Complex ID']
              }
            }

            if (i.destinationStationId !== undefined && dirUpTown[n]) {
              try {
                upTown.push({
                  routeId: i.routeId,
                  time: this.getDate(i.time, walkingTime[n]),
                  destination:
                    i.destinationStationId === '281'
                      ? stationIds['606'].name
                      : stationIds[i.destinationStationId].name,
                  walkingTime: walkingTime[n],
                })
              } catch (processingError) {
                console.log('Error processing northbound departure:', processingError.message)
              }
            }
          })
        }
      })
    })
  },

  sendTrainData: function(self, stations, upTown, downTown, isList, failedStations) {
    const data = [
      { downTown: downTown.filter((train) => train.time > 0) },
      { upTown: upTown.filter((train) => train.time > 0) }
    ]

    // Limit results for marquee mode
    if (!isList) {
      data[0].downTown = data[0].downTown.slice(0, 3)
      data[1].upTown = data[1].upTown.slice(0, 3)
    }

    // Include error information for failed stations
    const payload = {
      stations: stations,
      data: data
    }

    if (failedStations.length > 0) {
      payload.errors = failedStations
      console.log(`⚠️ ${failedStations.length} station(s) failed, but continuing with available data`)
    }

    self.sendSocketNotification('TRAIN_TABLE', payload)
  },

  getDate: function (time, walkingTime) {
    // time is a unix_timestamp
    var now = Math.round(new Date().getTime() / 1000)
    var secdiff = time - now
    var mindiff = Math.floor(secdiff / 60)

    mindiff = '0' + (mindiff % 60)

    // Will display time in minutes format
    var formattedTime = Number(mindiff.substr(-2))

    return formattedTime - walkingTime
  },

  //Subclass socketNotificationReceived received.
  socketNotificationReceived: function (notification, config) {
    if (notification === 'GET_DEPARTURES') {
      this.getDepartures(config)
    }
  },
})
