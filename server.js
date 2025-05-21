// File: server.js (updated to serve calculator files)

const express = require('express');
const cors = require('cors');
const couchbase = require('couchbase');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const archiver = require('archiver');
const { json2csv } = require('json-2-csv');

const app = express();
const port = process.env.PORT || 8091;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Couchbase connection setup
let cluster;
let bucket;
let collection;

async function connectToCouchbase() {
  try {
    cluster = await couchbase.connect('couchbase://localhost', {
      username: process.env.CB_USERNAME || 'Admin',
      password: process.env.CB_PASSWORD || '123456'
    });
    bucket = cluster.bucket('exam-app');
    collection = bucket.defaultCollection();
    console.log('Connected to Couchbase');
  } catch (error) {
    console.error('Error connecting to Couchbase:', error);
    process.exit(1);
  }
}

connectToCouchbase();

// Exam creation endpoint
// Update exam data structure in POST /api/exams endpoint
app.post('/api/exams', async (req, res) => {
  try {
    const examData = {
      type: 'exam',
      name: req.body.name,
      subject: req.body.subject,
      category: req.body.category,
      totalQuestions: req.body.totalQuestions,
      optionsPerQuestion: req.body.optionsPerQuestion,
      attemptedQuestions: req.body.attemptedQuestions,
      answers: req.body.answers,
      doubtQuestions: req.body.doubtQuestions,
      lastVisited: new Date().toISOString(),
      timerType: req.body.timerType,
      timeRemaining: req.body.timeRemaining,
      isExamStarted: req.body.isExamStarted,
      score: req.body.score,
      evaluation: req.body.evaluation || {},
      completed: req.body.completed || false,
      deleted: false // New field to track deletion status
    };

    const key = `exam::${req.body.name}`;
    await collection.upsert(key, examData);
    res.json({ success: true, message: 'Exam saved successfully' });
  } catch (error) {
    console.error('Error saving exam:', error);
    res.status(500).json({ success: false, message: 'Error saving exam' });
  }
});

// Get all subjects
app.get('/api/subjects', async (req, res) => {
  try {
    const query = `
      SELECT s.*
      FROM \`exam-app\`._default._default s
      WHERE s.type = 'subject'
      ORDER BY s.name
    `;
    const result = await cluster.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ success: false, message: 'Error fetching subjects' });
  }
});

// Create a new subject
app.post('/api/subjects', async (req, res) => {
  try {
    const subjectData = {
      type: 'subject',
      name: req.body.name,
      createdAt: new Date().toISOString()
    };
    const key = `subject::${req.body.name}`;
    await collection.upsert(key, subjectData);
    res.json({ success: true, message: 'Subject created successfully', data: subjectData });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ success: false, message: 'Error creating subject' });
  }
});

// Get categories for a subject
app.get('/api/subjects/:subject/categories', async (req, res) => {
  try {
    const query = `
      SELECT c.*
      FROM \`exam-app\`._default._default c
      WHERE c.type = 'category'
      AND c.subject = $subject
      ORDER BY c.name
    `;
    const result = await cluster.query(query, { parameters: { subject: req.params.subject } });
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ success: false, message: 'Error fetching categories' });
  }
});

// Create a new category
app.post('/api/subjects/:subject/categories', async (req, res) => {
  try {
    const categoryData = {
      type: 'category',
      name: req.body.name,
      subject: req.params.subject,
      createdAt: new Date().toISOString()
    };
    const key = `category::${req.params.subject}::${req.body.name}`;
    await collection.upsert(key, categoryData);
    res.json({ success: true, message: 'Category created successfully', data: categoryData });
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ success: false, message: 'Error creating category' });
  }
});

// Get exams for a category - Modified to handle archived exams better
app.get('/api/subjects/:subject/categories/:category/exams', async (req, res) => {
  try {
    // This query gets all parent exams in the category
    const parentExamsQuery = `
      SELECT e.*
      FROM \`exam-app\`._default._default e
      WHERE e.type = 'exam'
      AND e.subject = $subject
      AND e.category = $category
      AND (e.isReattempt IS MISSING OR e.isReattempt = false)
      ORDER BY e.lastVisited DESC
    `;
    
    const parentExams = await cluster.query(parentExamsQuery, {
      parameters: {
        subject: req.params.subject,
        category: req.params.category
      }
    });
    
    // Process each parent exam to determine if it has non-archived attempts
    const result = [];
    
    for (const parentExam of parentExams.rows) {
      // For each parent exam, check if it or any of its attempts are non-archived
      const attemptsQuery = `
        SELECT COUNT(*) as count
        FROM \`exam-app\`._default._default e
        WHERE e.type = 'exam'
        AND ((e.name = $examName) OR (e.originalExam = $examName))
        AND (e.deleted IS MISSING OR e.deleted = false)
      `;
      
      const attemptsCount = await cluster.query(attemptsQuery, {
        parameters: { examName: parentExam.name }
      });
      
      // If parent exam has any non-archived attempts, include it
      if (attemptsCount.rows[0].count > 0) {
        result.push(parentExam);
      }
    }
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching exams:', error);
    res.status(500).json({ success: false, message: 'Error fetching exams' });
  }
});

// Get all archived exams
app.get('/api/archived-exams', async (req, res) => {
  try {
    const query = `
      SELECT e.*
      FROM \`exam-app\`._default._default e
      WHERE e.type = 'exam'
      AND e.deleted = true
      ORDER BY e.lastVisited DESC
    `;
    const result = await cluster.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching archived exams:', error);
    res.status(500).json({ success: false, message: 'Error fetching archived exams' });
  }
});



// Get all exams
app.get('/api/exams', async (req, res) => {
  try {
    const query = `
      SELECT e.*
      FROM \`exam-app\`._default._default e
      WHERE e.type = 'exam'
      ORDER BY e.lastVisited DESC
    `;
    const result = await cluster.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching exams:', error);
    res.status(500).json({ success: false, message: 'Error fetching exams' });
  }
});

// Update GET exam endpoint with logging
app.get('/api/exams/:name', async (req, res) => {
  try {
    const key = `exam::${req.params.name}`;
    const result = await collection.get(key);
    let examData = result.value;

    // console.log('Raw exam data from DB:', JSON.stringify(examData, null, 2)); // Log raw data
    
    if (Array.isArray(examData.answers)) {
      // console.log('Converting array answers to object format');
      const answersObj = {};
      examData.answers.forEach((answer, index) => {
        answersObj[index + 1] = {
          ...answer,
          userAnswer: answer.userAnswer || '',
          numericalAnswer: answer.numericalAnswer || '',
          selectedOptions: answer.selectedOptions || []
        };
      });
      examData.answers = answersObj;
    }

    // console.log('Processed exam data:', JSON.stringify(examData, null, 2)); // Log processed data
    res.json(examData);
  } catch (error) {
    console.error('Error fetching exam:', error);
    res.status(500).json({ success: false, message: 'Error fetching exam' });
  }
});

// Update the /api/generate-report endpoint
app.get('/api/generate-report', async (req, res) => {
  try {
    const examName = req.query.exam;
    const reportType = req.query.reportType;
    
    // Get exam data
    const key = `exam::${examName}`;
    const result = await collection.get(key);
    const examData = result.value;

    // Prepare questions with evaluations
    const questions = Object.entries(examData.answers).map(([qId, answer]) => ({
      questionId: qId,
      ...answer,
      evaluation: examData.evaluation[qId] || 'not_evaluated'
    }));

    // Filter questions based on report type
    let filteredQuestions = questions;
    let totalQuestions = examData.totalQuestions;
    
    if(reportType === 'without') {
      filteredQuestions = questions.filter(q => 
          q.numericalAnswer?.trim() !== '' || 
          q.selectedOptions?.length > 0
      );
      totalQuestions = filteredQuestions.length;
      
      // Recalculate correct/wrong counts for filtered questions
      correctCount = filteredQuestions.filter(q => q.evaluation === 'correct').length;
      wrongCount = filteredQuestions.filter(q => q.evaluation === 'wrong').length;
    }

    // Calculate statistics
    const correctCount = filteredQuestions.filter(q => q.evaluation === 'correct').length;
    const wrongCount = filteredQuestions.filter(q => q.evaluation === 'wrong').length;
    const score = totalQuestions > 0 ? (correctCount / totalQuestions * 100).toFixed(2) : 0;

    // CSV content generation
    const csvOptions = {
      emptyFieldValue: '',
      keys: ['questionId', 'numericalAnswer', 'selectedOptions', 'evaluation']
    };

    if(reportType === 'both') {
      // ZIP with both reports
      const archive = archiver('zip');
      archive.pipe(res);
      res.attachment(`${examName}-reports.zip`);

      // With unanswered report
      const withCsv = await json2csv(questions, csvOptions);
      archive.append(withCsv + generateCsvSummary(examData.totalQuestions, correctCount, wrongCount), 
        { name: `${examName}-with-unanswered.csv` });

      // Without unanswered report
      const withoutQuestions = questions.filter(q => 
        q.numericalAnswer?.trim() !== '' || 
        q.selectedOptions?.length > 0
      );
      const withoutCsv = await json2csv(withoutQuestions, csvOptions);
      archive.append(withoutCsv + generateCsvSummary(withoutQuestions.length, correctCount, wrongCount), 
        { name: `${examName}-without-unanswered.csv` });

      archive.finalize();
    } else {
      const csv = await json2csv(filteredQuestions, csvOptions);
      res.attachment(`${examName}-report.csv`);
      res.send(csv + generateCsvSummary(totalQuestions, correctCount, wrongCount));
    }
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).send('Error generating report');
  }
});

// Helper function for CSV summary
function generateCsvSummary(total, correct, wrong) {
  const score = total > 0 ? (correct / total * 100).toFixed(2) : 0;
  return `\n\nSummary,Total Questions,Correct Answers,Wrong Answers,Score\n` +
         `,${total},${correct},${wrong},${score}%`;
}


// Add this endpoint to server.js or update if it exists
// In server.js, update the existing endpoint
app.get('/check-exam-name', async (req, res) => {
  try {
    const query = `
      SELECT COUNT(*) AS count
      FROM \`exam-app\`._default._default e
      WHERE e.type = 'exam' 
      AND e.name = $name
    `;
    
    const result = await cluster.query(query, { parameters: { name: req.query.name } });
    const exists = result.rows[0].count > 0;
    
    res.json({ exists: exists });
  } catch (error) {
    console.error('Error checking exam name:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});


// Delete exam
// Mark exam as deleted (archive) instead of removing
app.delete('/api/exams/:name', async (req, res) => {
  try {
    const key = `exam::${req.params.name}`;
    const result = await collection.get(key);
    const examData = result.value;
    
    // Update the deleted status
    examData.deleted = true;
    
    await collection.upsert(key, examData);
    res.json({ success: true, message: 'Exam archived successfully' });
  } catch (error) {
    console.error('Error archiving exam:', error);
    res.status(500).json({ success: false, message: 'Error archiving exam' });
  }
});

// Permanently delete an exam document
app.delete('/api/exams/:name/permanent', async (req, res) => {
  try {
    const key = `exam::${req.params.name}`;
    await collection.remove(key);
    return res.json({ success: true, message: 'Exam permanently deleted' });
  } catch (error) {
    console.error('Error permanently deleting exam:', error);
    return res.status(500).json({ success: false, message: 'Error deleting exam' });
  }
});

// Also allow POST to permanently delete (so fetch DELETE vs. POST both work)
app.post('/api/exams/:name/permanent', async (req, res) => {
  try {
    const key = `exam::${req.params.name}`;
    await collection.remove(key);
    return res.json({ success: true, message: 'Exam permanently deleted' });
  } catch (error) {
    console.error('Error permanently deleting exam (POST):', error);
    return res.status(500).json({ success: false, message: 'Error deleting exam' });
  }
});



// Enhanced endpoint to get all attempts for a specific exam
app.get('/api/exams/:name/attempts', async (req, res) => {
  try {
    console.log('Fetching attempts for exam:', req.params.name);
    if (!req.params.name) {
      return res.status(400).json({
        success: false,
        message: 'Exam name is required'
      });
    }
    
    // Modified query - removed the deleted filter
    const query = `
      SELECT e.*
      FROM \`exam-app\`._default._default e
      WHERE e.type = 'exam'
      AND ((e.name = $examName) OR (e.originalExam = $examName))
      ORDER BY e.lastVisited DESC
    `;
    
    const attempts = await cluster.query(query, {
      parameters: { examName: req.params.name }
    });
    console.log('Found attempts:', attempts.rows.length);
    res.json(attempts.rows);
  } catch (error) {
    console.error('Error fetching exam attempts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching exam attempts',
      error: error.message
    });
  }
});

// New endpoint to unarchive an exam
app.post('/api/exams/:name/unarchive', async (req, res) => {
  try {
    const key = `exam::${req.params.name}`;
    const result = await collection.get(key);
    const examData = result.value;
    
    // Update the deleted status to false
    examData.deleted = false;
    await collection.upsert(key, examData);
    
    res.json({ success: true, message: 'Exam unarchived successfully' });
  } catch (error) {
    console.error('Error unarchiving exam:', error);
    res.status(500).json({ success: false, message: 'Error unarchiving exam' });
  }
});


// New endpoint to get statistics for a specific exam
app.get('/api/exams/:name/statistics', async (req, res) => {
  try {
    const key = `exam::${req.params.name}`;
    
    // Check if the exam exists
    let examData;
    try {
      const result = await collection.get(key);
      examData = result.value;
    } catch (error) {
      if (error.message.includes('document not found')) {
        return res.status(404).json({ 
          success: false, 
          message: 'Exam not found' 
        });
      }
      throw error;
    }
    
    // Calculate statistics
    const answers = examData.answers || {};
    const evaluation = examData.evaluation || {};
    
    // Convert answers to array if it's an object
    let answersArray = Array.isArray(answers) ? answers : Object.values(answers);
    
    const totalQuestions = examData.totalQuestions || answersArray.length;
    const attemptedQuestions = answersArray.filter(q => 
      (q.numericalAnswer?.trim && q.numericalAnswer.trim() !== '') || 
      (Array.isArray(q.selectedOptions) && q.selectedOptions.length > 0)
    ).length;
    
    const correctCount = Object.values(evaluation).filter(val => val === 'correct').length;
    const wrongCount = Object.values(evaluation).filter(val => val === 'wrong').length;
    const unattemptedCount = totalQuestions - attemptedQuestions;
    
    const score = totalQuestions > 0 ? (correctCount / totalQuestions * 100).toFixed(2) : 0;
    
    const statistics = {
      totalQuestions,
      attemptedQuestions,
      correctCount,
      wrongCount,
      unattemptedCount,
      score: parseFloat(score)
    };
    
    res.json({
      success: true,
      data: statistics
    });
    
  } catch (error) {
    console.error('Error fetching exam statistics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching exam statistics', 
      error: error.message 
    });
  }
});



// Clone exam for reattempt
app.post('/api/exams/:name/reattempt', async (req, res) => {
  try {
    const key = `exam::${req.params.name}`;
    const result = await collection.get(key);
    const originalExam = result.value;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const newName = `${originalExam.name}-${timestamp}`;
    
    // Create a new exam based on the original, but reset answers and evaluation
    const newExamData = {
      type: 'exam',
      name: newName,
      subject: originalExam.subject,
      category: originalExam.category,
      totalQuestions: originalExam.totalQuestions,
      optionsPerQuestion: originalExam.optionsPerQuestion,
      timerType: originalExam.timerType,
      timeRemaining: originalExam.timeRemaining,
      currentTime: 0,
      attemptedQuestions: [],
      answers: {},
      doubtQuestions: [],
      lastVisited: new Date().toISOString(),
      isExamStarted: true,
      score: 0,
      evaluation: {},
      completed: false,
      deleted: false,
      isReattempt: true,
      originalExam: req.params.name
    };
    
    const newKey = `exam::${newName}`;
    await collection.upsert(newKey, newExamData);
    
    // res.json({ 
    //   success: true, 
    //   message: 'Exam cloned for reattempt', 
    //   data: { examName: newName }
    // });

    res.json({ 
     success: true, 
     message: 'Exam cloned for reattempt', 
     data: { 
       examName: newName,
       subject: originalExam.subject,
       category: originalExam.category
     }
   });
  } catch (error) {
    console.error('Error cloning exam:', error);
    res.status(500).json({ success: false, message: 'Error cloning exam' });
  }
});



// Update exam evaluation
app.post('/api/exams/:name/evaluate', async (req, res) => {
  try {
    const key = `exam::${req.params.name}`;
    const result = await collection.get(key);
    const examData = result.value;
    
    // Update evaluation data
    examData.evaluation = req.body.evaluation || {};
    examData.completed = true;
    
    // Calculate score based on evaluation
    const correctCount = Object.values(examData.evaluation).filter(val => val === 'correct').length;
    examData.score = correctCount;
    
    await collection.upsert(key, examData);
    res.json({ success: true, message: 'Evaluation saved successfully' });
  } catch (error) {
    console.error('Error saving evaluation:', error);
    res.status(500).json({ success: false, message: 'Error saving evaluation' });
  }
});

// Serve calculator files
app.use('/calculator.css', express.static(path.join(__dirname, 'public', 'calculator.css')));
app.use('/calculator.js', express.static(path.join(__dirname, 'public', 'calculator.js')));

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
