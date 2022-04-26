# meteocool

[meteocool](https://meteocool.com/) provides free & open-source
real-time rain radar and storm tracking functionality for iOS,
Android and the web. Currently available in Central Europe (DWD).
Use it to both chase or avoid upcoming weather - that's up to you.

![An exemplary cloud formation with high reflectivity (aka thunderstorm)](https://raw.githubusercontent.com/v4lli/meteocool/master/doc/pano-thunderstorm.jpg "An exemplary cloud formation with high reflectivity")

meteocool currently uses radar data provided by DWD, realtime lightning
information from the awesome blitzortung.org project and satellite imagery from Copernicus.

<a href="https://itunes.apple.com/de/app/meteocool-rain-radar/id1438364623"><img src="https://raw.githubusercontent.com/v4lli/meteocool/master/frontend/assets/download-on-appstore.png" style="width: 49%; float: left;" alt="Download on Apple Appstore"></a>
<a href="https://play.google.com/store/apps/details?id=com.meteocool"><img src="https://user-images.githubusercontent.com/1577223/57536457-84883480-7344-11e9-899d-c31ac124917c.png" style="width: 49%" alt="Download on Google Play Store"></a>

We welcome contributions of all kinds. The iOS and Android applications are maintained in their respective repositories. Check out the [Frequently Asked Questions](https://github.com/meteocool/core/wiki/FAQ) (currently only available in German).

## Features

<img src="https://raw.githubusercontent.com/v4lli/meteocool/master/doc/ios-lockscreen.png" alt="iOS Notifications" width="50%" align="right">

* **Automatic Map Updates:** the biggest inconvenience with most weather radar
  visualisations is out-of-date data. Meteocool notifies its clients as
  soon as new radar data becomes available and the client tries
  to be transparent about the dataset age. Say goodbye to hammering F5!
* **Live Lightning Strikes:** new lightning strikes are displayed instantly,
  giving you an even better feeling for the cloud formation's intensity,
  trajectory and speed.
* **Push Notifications:** get notified about incoming rain up to 60 minutes
  in advance. Requires iOS or Android App (currently not available on F-Droid).
* **Dark Mode:** great for HUD-like displays and general night time usage.
* **Progressive Web App:** responsive, connectivity independent and app-like.
* **iOS & Android Apps:** native iOS and Android apps provide battery-efficient
  background location services to allow for accurate rain notifications without
  user interaction.

<img width="100%" alt="Screenshot 2019-05-11 13 33 19" src="https://user-images.githubusercontent.com/1577223/57573080-444bb380-7423-11e9-935d-2a990f5026f6.png">

## Development

The meteocool frontend ist based on Svelte. The `develop` branch
is automatically deployed to the [staging
environment](https://better.meteocool.com), which can be viewed
after enabling the "Experimental Features" setting in the iOS app.

Most interactions between the native applications and the web
application happen through the Settings interface. If you are
planning to use meteocool for a dashboard/status display, I'd
recommend to check out possible HTTP request parameters for further
customization.

### Warning: Recreational Programming

I do not consider myself to be a web (nor frontend) developer, and
since I'm basically the only person working on this particular
component, nothing is clean, good practice or mature.  Some
code smells are documented in the issue tracker, most of
them are not.

Here be dragons, you have been warned. 🐲
