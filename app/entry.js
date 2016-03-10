'use strict';
let $ = require('jquery');

$('.availability-toggle-button').each((i, e) => {
  let button = $(e);
  button.click(() => {
    let scheduleId = button.data('schedule-id');
    let userId = button.data('user-id');
    let candidateId = button.data('candidate-id');
    let availability = parseInt(button.data('availability'));
    let nextAvailability = (availability + 1) % 3;
    $.post(`/schedules/${scheduleId}/users/${userId}/candidates/${candidateId}`,
      { availability: nextAvailability },
      (data) => {
        button.data('availability', data.availability);
        const availabilityLabels = ['欠', '？', '出'];
        button.text(availabilityLabels[data.availability]);
      });
  });
});

let buttonSelfComment = $('#self-comment-button');
buttonSelfComment.click(() => {
  let scheduleId = buttonSelfComment.data('schedule-id');
  let userId = buttonSelfComment.data('user-id');
  let comment = prompt('コメントを255文字以内で入力してください。');
  if (comment) {
    $.post(`/schedules/${scheduleId}/users/${userId}/comments`,
      { comment: comment },
      (data) => {
        $('#self-comment').text(data.comment);
      });
  }
});