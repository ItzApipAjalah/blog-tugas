require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const port = 3000;

// Supabase setup
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session.isAuthenticated) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Routes
app.get('/', async (req, res) => {
  try {
    const { data: blogs, error } = await supabase
      .from('blogs')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching blogs:', error);
      return res.render('home', { blogs: [] });
    }
    
    res.render('home', { blogs: blogs || [] });
  } catch (err) {
    console.error('Server error:', err);
    res.render('home', { blogs: [] });
  }
});

app.get('/blog/:id', async (req, res) => {
  try {
    const { data: blog, error } = await supabase
      .from('blogs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !blog) {
      console.error('Blog not found or error:', error);
      return res.redirect('/');
    }

    res.render('blog', { blog });
  } catch (err) {
    console.error('Server error:', err);
    res.redirect('/');
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.isAuthenticated = true;
    res.redirect('/admin');
  } else {
    res.redirect('/login');
  }
});

// Admin route to include blog listing
app.get('/admin', requireAuth, async (req, res) => {
  try {
    const { data: blogs, error } = await supabase
      .from('blogs')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching blogs:', error);
      return res.render('admin', { blogs: [] });
    }
    
    res.render('admin', { blogs: blogs || [] });
  } catch (err) {
    console.error('Error fetching blogs:', err);
    res.render('admin', { blogs: [] });
  }
});

// Edit blog page
app.get('/admin/edit/:id', requireAuth, async (req, res) => {
  try {
    const { data: blog, error } = await supabase
      .from('blogs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      console.error('Error fetching blog:', error);
      return res.redirect('/admin');
    }

    if (!blog) {
      console.error('Blog not found');
      return res.redirect('/admin');
    }

    console.log('Blog data:', blog); // Debug log
    res.render('edit', { blog });
  } catch (err) {
    console.error('Server error:', err);
    res.redirect('/admin');
  }
});

// Update blog post
app.post('/admin/edit/:id', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { title, description, remove_file } = req.body;
    const file = req.file;
    const blogId = req.params.id;

    // Get current blog data
    const { data: currentBlog } = await supabase
      .from('blogs')
      .select('file_url')
      .eq('id', blogId)
      .single();

    let fileUrl = currentBlog.file_url;

    // Handle file removal
    if (remove_file === 'on' && fileUrl) {
      const oldFileName = fileUrl.split('/').pop();
      await supabase.storage
        .from('blog-files')
        .remove([oldFileName]);
      fileUrl = null;
    }

    // Handle new file upload
    if (file) {
      // Remove old file if exists
      if (fileUrl) {
        const oldFileName = fileUrl.split('/').pop();
        await supabase.storage
          .from('blog-files')
          .remove([oldFileName]);
      }

      // Upload new file
      const filename = Date.now() + path.extname(file.originalname);
      const { error: uploadError } = await supabase.storage
        .from('blog-files')
        .upload(filename, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600'
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('blog-files')
        .getPublicUrl(filename);
      
      fileUrl = publicUrl;
    }

    // Update blog post
    const { error: updateError } = await supabase
      .from('blogs')
      .update({ title, description, file_url: fileUrl })
      .eq('id', blogId);

    if (updateError) throw updateError;
    res.redirect('/admin');
  } catch (err) {
    console.error('Error updating blog:', err);
    res.status(500).send('Error updating blog post');
  }
});

// Delete blog post
app.post('/admin/delete/:id', requireAuth, async (req, res) => {
  try {
    const blogId = req.params.id;

    // Get blog data to check for file
    const { data: blog } = await supabase
      .from('blogs')
      .select('file_url')
      .eq('id', blogId)
      .single();

    // Delete file if exists
    if (blog && blog.file_url) {
      const fileName = blog.file_url.split('/').pop();
      await supabase.storage
        .from('blog-files')
        .remove([fileName]);
    }

    // Delete blog post
    const { error: deleteError } = await supabase
      .from('blogs')
      .delete()
      .eq('id', blogId);

    if (deleteError) throw deleteError;
    res.redirect('/admin');
  } catch (err) {
    console.error('Error deleting blog:', err);
    res.status(500).send('Error deleting blog post');
  }
});

app.post('/admin/blog', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { title, description } = req.body;
    const file = req.file;

    let fileUrl = null;
    if (file) {
      const filename = Date.now() + path.extname(file.originalname);
      
      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('blog-files')
        .upload(filename, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600'
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('blog-files')
        .getPublicUrl(filename);
      
      fileUrl = publicUrl;
    }

    // Insert blog post with file URL
    const { error: insertError } = await supabase
      .from('blogs')
      .insert([{ title, description, file_url: fileUrl }]);

    if (insertError) throw insertError;
    res.redirect('/');
  } catch (err) {
    console.error('Error creating blog post:', err);
    res.status(500).send('Error creating blog post');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
