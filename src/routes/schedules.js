const { Hono } = require("hono");
const { html } = require("hono/html");
const layout = require("../layout");
const ensureAuthenticated = require("../middlewares/ensure-authenticated");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ log: ["query"] });

const app = new Hono();

async function createCandidates(candidateNames, scheduleId) {
  const candidates = candidateNames.map((candidateName) => ({
    candidateName,
    scheduleId,
  }));
  await prisma.candidate.createMany({
    data: candidates,
  });
}

function parseCandidateNames(candidatesStr) {
  return candidatesStr
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
app.get("/new", ensureAuthenticated(), (c) => {
  return c.html(
    layout(
      c,
      "予定の作成",
      html`
        <form method="post" action="/schedules">
          <div>
            <h5>予定名</h5>
            <input type="text" name="scheduleName" />
          </div>
          <div>
            <h5>メモ</h5>
            <textarea name="memo"></textarea>
          </div>
          <div>
            <h5>候補日程 (改行して複数入力してください)</h5>
            <textarea name="candidates"></textarea>
          </div>
          <button type="submit">予定をつくる</button>
        </form>
      `,
    ),
  );
});

app.post("/", ensureAuthenticated(), async (c) => {
  const { user } = c.get("session") ?? {};
  const body = await c.req.parseBody();

  // 予定を登録
  const schedule = await prisma.schedule.create({
    data: {
      scheduleId: uuidv4(),
      scheduleName: body.scheduleName.slice(0, 255) || "（名称未設定）",
      memo: body.memo,
      createdBy: user.id,
      updatedAt: new Date(),
    },
  });

  // 候補日程を登録
  const candidateNames = parseCandidateNames(body.candidates);
  await createCandidates(candidateNames, schedule.scheduleId);

  // 作成した予定のページにリダイレクト
  return c.redirect("/schedules/" + schedule.scheduleId);
});

app.get("/:scheduleId", ensureAuthenticated(), async (c) => {
  const { user } = c.get("session") ?? {};
  const schedule = await prisma.schedule.findUnique({
    where: { scheduleId: c.req.param("scheduleId") },
    include: {
      user: {
        select: {
          userId: true,
          username: true,
        },
      },
    },
  });

  if (!schedule) {
    return c.notFound();
  }

  const candidates = await prisma.candidate.findMany({
    where: { scheduleId: schedule.scheduleId },
    orderBy: { candidateId: "asc" },
  });

  // データベースからその予定の全ての出欠を取得する
  const availabilities = await prisma.availability.findMany({
    where: { scheduleId: schedule.scheduleId },
    orderBy: { candidateId: "asc" },
    include: {
      user: {
        select: {
          userId: true,
          username: true,
        },
      },
    },
  });
  // 出欠 MapMap を作成する
  const availabilityMapMap = new Map(); // key: userId, value: Map(key: candidateId, value: availability)
  availabilities.forEach((a) => {
    const map = availabilityMapMap.get(a.user.userId) || new Map();
    map.set(a.candidateId, a.availability);
    availabilityMapMap.set(a.user.userId, map);
  });

  // 閲覧ユーザと出欠に紐づくユーザからユーザ Map を作る
  const userMap = new Map(); // key: userId, value: User
  userMap.set(parseInt(user.id), {
    isSelf: true,
    userId: parseInt(user.id),
    username: user.username,
  });
  availabilities.forEach((a) => {
    userMap.set(a.user.userId, {
      isSelf: parseInt(user.id) === a.user.userId, // 閲覧ユーザ自身であるかを示す真偽値
      userId: a.user.userId,
      username: a.user.username,
    });
  });

  // 全ユーザ、全候補で二重ループしてそれぞれの出欠の値がない場合には、「欠席」を設定する
  const users = Array.from(userMap.values());
  users.forEach((u) => {
    candidates.forEach((c) => {
      const map = availabilityMapMap.get(u.userId) || new Map();
      const a = map.get(c.candidateId) || 0; // デフォルト値は 0 を使用
      map.set(c.candidateId, a);
      availabilityMapMap.set(u.userId, map);
    });
  });

  // コメント取得
  const comments = await prisma.comment.findMany({
    where: { scheduleId: schedule.scheduleId },
  });
  const commentMap = new Map(); // key: userId, value: comment
  comments.forEach((comment) => {
    commentMap.set(comment.userId, comment.comment);
  });

  return c.html(
    layout(
      c,
      `予定: ${schedule.scheduleName}`,
      html`
        <h4>${schedule.scheduleName}</h4>
        <p style="white-space: pre;">${schedule.memo}</p>
        <p>作成者: ${schedule.user.username}</p>
        ${isMine(user.id, schedule)
          ? html`<a href="/schedules/${schedule.scheduleId}/edit"
              >この予定を編集する</a
            >`
          : ""}
        <h3>出欠表</h3>
        <table>
          <tr>
            <th>予定</th>
            ${users.map((user) => html`<th>${user.username}</th>`)}
          </tr>
          ${candidates.map(
            (candidate) => html`
              <tr>
                <th>${candidate.candidateName}</th>
                ${users.map((user) => {
                  const availability = availabilityMapMap
                    .get(user.userId)
                    .get(candidate.candidateId);
                  const availabilityLabels = ["欠", "？", "出"];
                  const label = availabilityLabels[availability];
                  return html`
                    <td>
                      ${user.isSelf
                        ? html` <button
                            data-schedule-id="${schedule.scheduleId}"
                            data-user-id="${user.userId}"
                            data-candidate-id="${candidate.candidateId}"
                            data-availability="${availability}"
                            class="availability-toggle-button"
                          >
                            ${label}
                          </button>`
                        : html`<p>${label}</p>`}
                    </td>
                  `;
                })}
              </tr>
            `,
          )}
          <tr>
            <th>コメント</th>
            ${users.map((user) => {
              const comment = commentMap.get(user.userId);
              return html`
                <td>
                  <p id="${user.isSelf ? "self-comment" : ""}">${comment}</p>
                  ${user.isSelf
                    ? html`
                        <button
                          data-schedule-id="${schedule.scheduleId}"
                          data-user-id="${user.userId}"
                          id="self-comment-button"
                        >
                          編集
                        </button>
                      `
                    : ""}
                </td>
              `;
            })}
          </tr>
        </table>
      `,
    ),
  );
});

function isMine(userId, schedule) {
  return schedule && parseInt(schedule.createdBy, 10) === parseInt(userId, 10);
}

app.get("/:scheduleId/edit", ensureAuthenticated(), async (c) => {
  const { user } = c.get("session") ?? {};
  const schedule = await prisma.schedule.findUnique({
    where: { scheduleId: c.req.param("scheduleId") },
  });
  if (!isMine(user.id, schedule)) {
    return c.notFound();
  }

  const candidates = await prisma.candidate.findMany({
    where: { scheduleId: schedule.scheduleId },
    orderBy: { candidateId: "asc" },
  });

  return c.html(
    layout(
      c,
      `予定の編集: ${schedule.scheduleName}`,
      html`
        <form method="post" action="/schedules/${schedule.scheduleId}/update">
          <div>
            <h5>予定名</h5>
            <input
              type="text"
              name="scheduleName"
              value="${schedule.scheduleName}"
            />
          </div>
          <div>
            <h5>メモ</h5>
            <textarea name="memo">${schedule.memo}</textarea>
          </div>
          <div>
            <h5>既存の候補日程</h5>
            <ul>
              ${candidates.map(
                (candidate) => html`<li>${candidate.candidateName}</li>`,
              )}
            </ul>
            <p>候補日程の追加 (改行して複数入力してください)</p>
            <textarea name="candidates"></textarea>
          </div>
          <button type="submit">以上の内容で予定を編集する</button>
        </form>
        <h3>危険な変更</h3>
        <form method="post" action="/schedules/${schedule.scheduleId}/delete">
          <button type="submit">この予定を削除する</button>
        </form>
      `,
    ),
  );
});

app.post("/:scheduleId/update", ensureAuthenticated(), async (c) => {
  const { user } = c.get("session") ?? {};
  const schedule = await prisma.schedule.findUnique({
    where: { scheduleId: c.req.param("scheduleId") },
  });
  if (!isMine(user.id, schedule)) {
    return c.notFound();
  }

  const body = await c.req.parseBody();
  const updatedSchedule = await prisma.schedule.update({
    where: { scheduleId: schedule.scheduleId },
    data: {
      scheduleName: body.scheduleName.slice(0, 255) || "（名称未設定）",
      memo: body.memo,
      updatedAt: new Date(),
    },
  });

  // 候補が追加されているかチェック
  const candidateNames = parseCandidateNames(body.candidates);
  if (candidateNames.length) {
    await createCandidates(candidateNames, updatedSchedule.scheduleId);
  }

  return c.redirect("/schedules/" + updatedSchedule.scheduleId);
});

async function deleteScheduleAggregate(scheduleId) {
  await prisma.availability.deleteMany({ where: { scheduleId } });
  await prisma.candidate.deleteMany({ where: { scheduleId } });
  await prisma.comment.deleteMany({ where: { scheduleId } });
  await prisma.schedule.delete({ where: { scheduleId } });
}
app.deleteScheduleAggregate = deleteScheduleAggregate;

app.post("/:scheduleId/delete", ensureAuthenticated(), async (c) => {
  const { user } = c.get("session") ?? {};
  const schedule = await prisma.schedule.findUnique({
    where: { scheduleId: c.req.param("scheduleId") },
  });
  if (!isMine(user.id, schedule)) {
    return c.notFound();
  }

  await deleteScheduleAggregate(schedule.scheduleId);
  return c.redirect("/");
});

module.exports = app;
