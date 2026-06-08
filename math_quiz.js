const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const statusEl = document.querySelector("#status");
const questionIndexEl = document.querySelector("#questionIndex");
const scoreEl = document.querySelector("#score");
const timerEl = document.querySelector("#timer");
const totalTimeEl = document.querySelector("#totalTime");
const questionTextEl = document.querySelector("#questionText");
const feedbackEl = document.querySelector("#feedback");
const endPanelEl = document.querySelector("#endPanel");
const endStatsEl = document.querySelector("#endStats");
const retryButton = document.querySelector("#retryButton");

const HOLD_MS = 500;
const QUESTION_MS = 12000;
const NEXT_DELAY_MS = 900;

const questions = [
  { text: "2 × 3 = ?", answer: 6 },
  { text: "2 × 5 = ?", answer: 10 },
  { text: "9 ÷ 3 = ?", answer: 3 },
  { text: "8 ÷ 2 = ?", answer: 4 },
  { text: "7 + 2 = ?", answer: 9 },
  { text: "6 + 4 = ?", answer: 10 },
  { text: "3x - 2 = 13", answer: 5 },
  { text: "2(x + 3) = 16", answer: 5 },
  { text: "2x = 8", answer: 4 },
  { text: "3x = 9", answer: 3 },
  { text: "x ÷ 2 = 5", answer: 10 },
  { text: "x ÷ 3 = 2", answer: 6 },
  { text: "x + 1 = 1", answer: 0 },
  { text: "10 - x = 7", answer: 3 },
  { text: "8 - x = 2", answer: 6 },
  { text: "x + x = 10", answer: 5 },
  { text: "2x + 1 = 7", answer: 3 },
  { text: "x + 3 = 10", answer: 7 },
  { text: "3x - 2 = 13", answer: 5 },
  { text: "2(x + 3) = 16", answer: 5 },
  { text: "x² = 49，x > 0", answer: 7 },
  { text: "√(x + 9) = 4", answer: 7 },
  { text: "(x + 2) / 3 = 4", answer: 10 },
  { text: "5x - 12 = 18", answer: 6 },
  { text: "2ˣ = 8", answer: 3 },
  { text: "x² - 5x = 0，x > 0", answer: 5 },
  { text: "3x + 4 = 25", answer: 7 },
  { text: "4(x - 1) = 20", answer: 6 },
];

let detections = [];
let cameraStarted = false;
let questionStartedAt = performance.now();
let quizStartedAt = performance.now();
let finalElapsedMs = 0;
let currentQuestion = 0;
let score = 0;
let locked = false;
let lastPose = null;
let poseStartedAt = 0;
let holdProgress = 0;
let shownAnswer = 0;
let confetti = [];
let finaleBursts = [];
let nextTimerId = null;
let quizFinished = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return rect;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boundsFor(landmarks) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function fingerExtended(landmarks, tipIndex, pipIndex, wrist, scale) {
  const tipDistance = distance(landmarks[tipIndex], wrist);
  const pipDistance = distance(landmarks[pipIndex], wrist);
  const tipAboveJoint = landmarks[tipIndex].y < landmarks[pipIndex].y + scale * 0.08;

  return tipDistance > pipDistance * 1.1 && tipAboveJoint;
}

function handPoseValue(landmarks) {
  const wrist = landmarks[0];
  const bounds = boundsFor(landmarks);
  const scale = Math.max(bounds.width, bounds.height, 0.001);
  const indexOpen = fingerExtended(landmarks, 8, 6, wrist, scale);
  const middleOpen = fingerExtended(landmarks, 12, 10, wrist, scale);
  const ringOpen = fingerExtended(landmarks, 16, 14, wrist, scale);
  const pinkyOpen = fingerExtended(landmarks, 20, 18, wrist, scale);
  const thumbOpen =
    distance(landmarks[4], wrist) > distance(landmarks[3], wrist) * 1.08 &&
    distance(landmarks[4], landmarks[9]) > scale * 0.34 &&
    distance(landmarks[4], landmarks[8]) > scale * 0.18;
  let count = 0;

  if (indexOpen) count += 1;
  if (middleOpen) count += 1;
  if (ringOpen) count += 1;
  if (pinkyOpen) count += 1;
  if (thumbOpen) count += 1;

  const taiwanSix = thumbOpen && pinkyOpen && !indexOpen && !middleOpen && !ringOpen;
  const taiwanSeven = thumbOpen && indexOpen && !middleOpen && !ringOpen && !pinkyOpen;
  const taiwanEight = thumbOpen && indexOpen && middleOpen && !ringOpen && !pinkyOpen;
  const taiwanNine = thumbOpen && indexOpen && middleOpen && ringOpen && !pinkyOpen;
  let value = clamp(count, 0, 5);

  if (taiwanSix) value = 6;
  if (taiwanSeven) value = 7;
  if (taiwanEight) value = 8;
  if (taiwanNine) value = 9;

  return {
    count: clamp(count, 0, 5),
    value,
    isTaiwanPose: value > 5,
  };
}

function onHandsResults(results) {
  detections = [];

  if (!cameraStarted) {
    cameraStarted = true;
    statusEl.textContent = "請用 0 到 10 的手勢作答";
    setTimeout(() => statusEl.classList.add("hidden"), 900);
  }

  const hands = results.multiHandLandmarks || [];

  for (let i = 0; i < hands.length; i += 1) {
    const landmarks = hands[i].map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z || 0,
    }));
    const pose = handPoseValue(landmarks);
    detections.push({
      bounds: boundsFor(landmarks),
      count: pose.count,
      value: pose.value,
      isTaiwanPose: pose.isTaiwanPose,
    });
  }
}

function currentPoseAnswer() {
  if (detections.length === 0) {
    return null;
  }

  let total = 0;

  if (detections.length === 1 && detections[0].isTaiwanPose) {
    return detections[0].value;
  }

  for (const detection of detections) {
    if (detection.isTaiwanPose) {
      return detection.value;
    }
  }

  for (const detection of detections) {
    total += detection.count;
  }

  return clamp(total, 0, 10);
}

function updateQuestionUi() {
  const question = questions[currentQuestion];
  questionIndexEl.textContent = `${currentQuestion + 1} / ${questions.length}`;
  scoreEl.textContent = `得分 ${score}`;
  questionTextEl.textContent = question ? question.text : "已完成！";
}

function startQuestion(index) {
  if (nextTimerId) {
    clearTimeout(nextTimerId);
    nextTimerId = null;
  }

  currentQuestion = index;
  locked = false;
  lastPose = null;
  holdProgress = 0;
  poseStartedAt = performance.now();
  questionStartedAt = performance.now();
  quizFinished = false;
  feedbackEl.textContent = index >= questions.length ? "太棒了！" : "用手指比出答案，並保持不動。";
  feedbackEl.className = "quiz-feedback";
  updateQuestionUi();
}

function finishQuiz() {
  locked = true;
  quizFinished = true;
  finalElapsedMs = performance.now() - quizStartedAt;
  questionTextEl.textContent = "挑戰完成！";
  questionIndexEl.textContent = `${questions.length} / ${questions.length}`;
  timerEl.textContent = "完成";
  totalTimeEl.textContent = `總時間 ${formatTime(finalElapsedMs)}`;
  feedbackEl.textContent = `最後得分：${score} / ${questions.length}`;
  feedbackEl.className = "quiz-feedback correct";
  endStatsEl.innerHTML = `得分 ${score} / ${questions.length}<br>總時間 ${formatTime(finalElapsedMs)}`;
  endPanelEl.classList.remove("hidden");
  addFinale();
}

function nextQuestionSoon() {
  if (nextTimerId) {
    clearTimeout(nextTimerId);
  }

  nextTimerId = setTimeout(() => {
    nextTimerId = null;
    if (currentQuestion + 1 >= questions.length) {
      finishQuiz();
    } else {
      startQuestion(currentQuestion + 1);
    }
  }, NEXT_DELAY_MS);
}

function formatTime(ms) {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

function resetQuiz() {
  if (nextTimerId) {
    clearTimeout(nextTimerId);
    nextTimerId = null;
  }

  score = 0;
  currentQuestion = 0;
  finalElapsedMs = 0;
  quizStartedAt = performance.now();
  questionStartedAt = quizStartedAt;
  locked = false;
  quizFinished = false;
  lastPose = null;
  poseStartedAt = quizStartedAt;
  holdProgress = 0;
  shownAnswer = 0;
  confetti = [];
  finaleBursts = [];
  endPanelEl.classList.add("hidden");
  timerEl.textContent = `本題 ${(QUESTION_MS / 1000).toFixed(1)} 秒`;
  totalTimeEl.textContent = "總時間 0.0 秒";
  feedbackEl.textContent = "用手指比出答案，並保持不動。";
  feedbackEl.className = "quiz-feedback";
  updateQuestionUi();
}

function addConfetti(rect) {
  const originX = rect.width * 0.5;
  const originY = rect.height * 0.22;

  for (let i = 0; i < 80; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    confetti.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      size: 7 + Math.random() * 10,
      color: ["#ff3f8f", "#16c7df", "#ffe82e", "#baff2a", "#fff8dc"][Math.floor(Math.random() * 5)],
      life: 1,
      decay: 0.012 + Math.random() * 0.016,
      spin: Math.random() * Math.PI,
    });
  }
}

function addFinale() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 980;
  const height = rect.height || 560;

  for (let i = 0; i < 7; i += 1) {
    finaleBursts.push({
      x: width * (0.16 + Math.random() * 0.68),
      y: height * (0.18 + Math.random() * 0.48),
      radius: 0,
      maxRadius: 70 + Math.random() * 90,
      life: 1,
      color: ["#ff3f8f", "#16c7df", "#ffe82e", "#baff2a"][Math.floor(Math.random() * 4)],
    });
  }

  for (let i = 0; i < 240; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 12;
    confetti.push({
      x: width * 0.5,
      y: height * 0.22,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 7,
      size: 8 + Math.random() * 14,
      color: ["#ff3f8f", "#16c7df", "#ffe82e", "#baff2a", "#fff8dc"][Math.floor(Math.random() * 5)],
      life: 1.2,
      decay: 0.006 + Math.random() * 0.012,
      spin: Math.random() * Math.PI,
    });
  }
}

function registerAnswer(answer, rect) {
  if (locked || currentQuestion >= questions.length) {
    return;
  }

  const correct = questions[currentQuestion].answer;

  if (answer === correct) {
    locked = true;
    score += 1;
    feedbackEl.textContent = "答對了！";
    feedbackEl.className = "quiz-feedback correct";
    scoreEl.textContent = `得分 ${score}`;
    addConfetti(rect);
    nextQuestionSoon();
  } else {
    feedbackEl.textContent = `再試一次：${answer} 不是答案。`;
    feedbackEl.className = "quiz-feedback wrong";
    lastPose = null;
    holdProgress = 0;
  }
}

function updateGame(time, rect) {
  if (currentQuestion >= questions.length) {
    return;
  }

  const elapsed = quizFinished ? finalElapsedMs : time - quizStartedAt;
  totalTimeEl.textContent = `總時間 ${formatTime(elapsed)}`;

  const remaining = Math.max(0, QUESTION_MS - (time - questionStartedAt));
  timerEl.textContent = `本題 ${(remaining / 1000).toFixed(1)} 秒`;

  if (!locked && remaining <= 0) {
    locked = true;
    feedbackEl.textContent = `時間到！答案是 ${questions[currentQuestion].answer}。`;
    feedbackEl.className = "quiz-feedback wrong";
    nextQuestionSoon();
    return;
  }

  if (locked) {
    return;
  }

  const pose = currentPoseAnswer();

  if (pose === null) {
    lastPose = null;
    holdProgress = 0;
    return;
  }

  if (pose !== lastPose) {
    lastPose = pose;
    poseStartedAt = time;
    holdProgress = 0;
  } else {
    holdProgress = clamp((time - poseStartedAt) / HOLD_MS, 0, 1);
  }

  if (holdProgress >= 1) {
    registerAnswer(pose, rect);
  }
}

function drawNumberText(text, x, y, size, color, accent, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.font = `900 ${size}px "Orbitron", "Rajdhani", "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  ctx.shadowColor = "rgba(49, 230, 255, 0.7)";
  ctx.shadowBlur = size * 0.18;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(10, size * 0.16);
  ctx.strokeStyle = "rgba(1, 8, 20, 0.96)";
  ctx.strokeText(text, 0, 0);

  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.lineWidth = Math.max(5, size * 0.075);
  ctx.strokeStyle = "rgba(210, 250, 255, 0.92)";
  ctx.strokeText(text, 0, 0);

  const gradient = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.2, accent);
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function drawPoseProgress(rect, time) {
  const pose = currentPoseAnswer();
  const text = pose === null ? "?" : String(pose);
  const x = rect.width * 0.5;
  const y = rect.height * 0.82;
  const radius = Math.min(rect.width, rect.height) * 0.115;
  const color = holdProgress > 0.98 ? "#76ff8a" : "#31e6ff";

  shownAnswer = lerp(shownAnswer, pose === null ? 0 : pose, 0.25);

  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.fillStyle = "rgba(5, 12, 28, 0.88)";
  ctx.strokeStyle = "rgba(112, 241, 255, 0.64)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, radius * 1.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * holdProgress);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(9, radius * 0.15);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  drawNumberText(text, x, y, radius * 1.15, "#31e6ff", "#ff4fd8", Math.sin(time * 0.004) * 0.035);
}

function drawHandBadges(rect) {
  for (let i = 0; i < detections.length; i += 1) {
    const detection = detections[i];
    const handPixels = Math.max(detection.bounds.width * rect.width, detection.bounds.height * rect.height);
    const size = clamp(handPixels * 0.36, 32, 72);
    const x = detection.bounds.x * rect.width;
    const y = clamp(detection.bounds.y * rect.height - size * 1.1, size * 0.8, rect.height - size);
    drawNumberText(String(detection.value), x, y, size, i % 2 ? "#ff4fd8" : "#76ff8a", "#ffffff", 0);
  }
}

function drawConfetti() {
  confetti = confetti.filter((piece) => {
    piece.x += piece.vx;
    piece.y += piece.vy;
    piece.vy += 0.18;
    piece.life -= piece.decay;
    piece.spin += 0.16;

    if (piece.life <= 0) {
      return false;
    }

    ctx.save();
    ctx.globalAlpha = piece.life;
    ctx.fillStyle = piece.color;
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.spin);
    ctx.fillRect(-piece.size * 0.5, -piece.size * 0.5, piece.size, piece.size * 0.72);
    ctx.restore();
    return true;
  });
}

function drawFinaleBursts() {
  finaleBursts = finaleBursts.filter((burst) => {
    burst.radius = lerp(burst.radius, burst.maxRadius, 0.08);
    burst.life -= 0.012;

    if (burst.life <= 0) {
      return false;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, burst.life);
    ctx.strokeStyle = burst.color;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(burst.x, burst.y, burst.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = Math.max(0, burst.life * 0.55);
    ctx.lineWidth = 4;
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(burst.x + Math.cos(angle) * burst.radius * 0.72, burst.y + Math.sin(angle) * burst.radius * 0.72);
      ctx.lineTo(burst.x + Math.cos(angle) * burst.radius * 1.16, burst.y + Math.sin(angle) * burst.radius * 1.16);
      ctx.stroke();
    }

    ctx.restore();
    return true;
  });
}

function renderFrame(time) {
  const rect = resizeCanvas();
  ctx.clearRect(0, 0, rect.width, rect.height);
  updateGame(time, rect);
  drawHandBadges(rect);
  drawPoseProgress(rect, time);
  drawFinaleBursts();
  drawConfetti();
  requestAnimationFrame(renderFrame);
}

async function startApp() {
  if (!window.Hands || !window.Camera) {
    statusEl.textContent = "MediaPipe 載入失敗，請確認網路後重新整理。";
    return;
  }

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.68,
    minTrackingConfidence: 0.68,
    selfieMode: true,
  });
  hands.onResults(onHandsResults);

  const camera = new Camera(video, {
    width: 1280,
    height: 720,
    facingMode: "user",
    onFrame: async () => {
      await hands.send({ image: video });
    },
  });

  try {
    updateQuestionUi();
    await camera.start();
    resetQuiz();
    requestAnimationFrame(renderFrame);
  } catch (error) {
    console.error(error);
    statusEl.textContent = "需要允許攝影機權限才能進行數學遊戲。";
  }
}

window.addEventListener("resize", resizeCanvas);
retryButton.addEventListener("click", resetQuiz);
startApp();
