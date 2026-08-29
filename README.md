<div align="center">

# Read Aloud

*Point a phone at a page and hear what it says*

[![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Hand%20Landmarker-00897b?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/edge/mediapipe)
[![Claude](https://img.shields.io/badge/Claude-Vision-d97757?style=flat-square&logo=anthropic&logoColor=white)](https://www.anthropic.com)

</div>

A camera app for someone who cannot read the screen or the letter in front of them. It
reads the page back out loud: what kind of document it is, what the form is asking for,
what the buttons say, when the bill is due.

Built for a family member who is losing their sight, which shaped every decision in it.

## The problem with a camera app for a blind user

A phone camera assumes you can see the viewfinder. Every affordance it normally gives you
is visual: a shutter button to aim at, a preview to check the framing, a spinner to tell
you something is happening. None of that survives contact with a user who cannot see the
screen.

So the interface here has no visual state at all.

**Nothing is tapped.** Finding a button on glass you cannot see is the hard part, so there
is no button. MediaPipe's hand landmarker watches the camera feed, and raising a finger
into frame is the shutter. The hand has to leave the frame before it will fire again,
which is what stops a resting hand from triggering it in a loop.

**Everything is audible.** A two second countdown ticks and speaks so you know a photo is
coming and can hold still. A shutter click confirms it fired. The reply is spoken. If the
model sees nothing readable, it says so rather than failing silently, because silence is
indistinguishable from a crash when you cannot see the screen.

**The screen goes black.** There is nothing on it worth lighting up, and a phone held up
to read a page is a phone burning battery on a display no one is looking at.

## How a capture flows

```
hand enters frame          MediaPipe hand landmarker, GPU delegate, 60ms poll
  -> countdown             two ticks, spoken, so the user can hold the page still
  -> capture               768px wide JPEG at quality 0.82, drawn from the video frame
  -> POST /api/analyze     serverless function, holds the API key
  -> Claude vision         reads the page, returns speech shaped text
  -> speechSynthesis       local voice, rate 0.85
```

The API key lives in the serverless function and never reaches the browser, so the
deployed client has nothing worth extracting from it.

`speechSynthesis` gets a nudge every five seconds because iOS Safari pauses long
utterances partway through, which truncates exactly the long readings this app exists to
produce.

## Layout

```
index.html        black screen, video element, canvas for the capture
src/main.js       gesture trigger, countdown, audio cues, speech
api/analyze.js    serverless vision call and the prompt that bounds it
dev-server.js     local stand in for the serverless function
```

## Credits

Hand tracking by [MediaPipe](https://ai.google.dev/edge/mediapipe). Vision by
[Claude](https://www.anthropic.com). Speech by the browser's built in
`SpeechSynthesis`, chosen over a hosted voice so a reading costs nothing and works
without a second network round trip.
